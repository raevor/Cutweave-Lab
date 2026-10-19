"""Package Qualcomm's official QuickSRNet Medium 2x FP32 checkpoint for CPU.

No torch import or arbitrary pickle globals: decode tensor storage only. The
seven convolutions and Clip(0,1) follow upstream QuickSRNetBase exactly.
"""
from pathlib import Path
from collections import OrderedDict, defaultdict
import hashlib, io, pickle, zipfile
import numpy as np
import onnx
from onnx import helper as h, numpy_helper as nh, TensorProto as T

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.cache/quicksrnet/medium-2x.pth.tar'

class IgnoredOptimizer:
    def __setstate__(self, state):
        self.state = state

def tensor(storage, offset, shape, stride, *_):
    storage = storage[offset:]
    assert all(s >= 0 for s in stride)
    assert sum((n-1)*s for n,s in zip(shape,stride)) < storage.size
    return np.lib.stride_tricks.as_strided(storage, shape, tuple(s*4 for s in stride)).copy()

class WeightsOnly(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {
            ('collections','OrderedDict'): OrderedDict,
            ('collections','defaultdict'): defaultdict,
            ('__builtin__','dict'): dict,
            ('torch','FloatStorage'): 'float32',
            ('torch._utils','_rebuild_tensor_v2'): tensor,
            ('torch._utils','_rebuild_parameter'): lambda value,*_: ('ignored-optimizer-parameter',id(value)),
            ('torch.optim.adam','Adam'): IgnoredOptimizer,
        }
        if (module,name) not in allowed: raise ValueError((module,name))
        return allowed[module,name]
    def persistent_load(self, entry):
        kind,dtype,key,_,count=entry
        assert kind=='storage' and dtype=='float32'
        values=np.frombuffer(archive.read(prefix+'data/'+key),dtype='<f4')
        assert len(values)==count
        return values

with zipfile.ZipFile(SOURCE) as archive:
    entry=next(n for n in archive.namelist() if n.endswith('data.pkl'))
    prefix=entry[:-len('data.pkl')]
    weights=WeightsOnly(io.BytesIO(archive.read(entry))).load()['state_dict']

expected=[f'cnn.{i}.{suffix}' for i in range(0,12,2) for suffix in ('weight','bias')]
expected += ['conv_last.weight','conv_last.bias']
assert set(weights)==set(expected), list(weights)
nodes=[];initializers=[nh.from_array(np.array(0,np.float32),'min'),nh.from_array(np.array(1,np.float32),'max')]
previous='input'
for i,base in enumerate([f'cnn.{j}' for j in range(0,12,2)]+['conv_last']):
    w,b=weights[base+'.weight'],weights[base+'.bias']
    assert w.shape==((12 if i==6 else 32),(3 if i==0 else 32),3,3)
    assert b.shape==(w.shape[0],) and np.isfinite(w).all() and np.isfinite(b).all()
    for suffix in ('weight','bias'):
        initializers.append(nh.from_array(weights[base+'.'+suffix],base+'.'+suffix))
    conv=f'conv{i}';out=f'clip{i}'
    nodes += [h.make_node('Conv',[previous,base+'.weight',base+'.bias'],[conv],pads=[1,1,1,1],kernel_shape=[3,3]),
              h.make_node('Clip',[conv,'min','max'],[out])]
    previous=out

def package(native):
    tail=[]
    if native:
        # Clip each subpixel first; native enhancement never makes a 2x image.
        tail.extend([h.make_node('Transpose',[previous],['nhwc'],perm=[0,2,3,1]),
          h.make_node('Reshape',['nhwc','groups'],['subpixels']),
          h.make_node('ReduceMean',['subpixels'],['mean'],axes=[4],keepdims=0),
          h.make_node('Transpose',['mean'],['output'],perm=[0,3,1,2])])
    else:
        tail.append(h.make_node('DepthToSpace',[previous],['output'],blocksize=2,mode='CRD'))
    graph=h.make_graph(nodes+tail,'QuickSRNetMediumNative' if native else 'QuickSRNetMedium2x',
       [h.make_tensor_value_info('input',T.FLOAT,[1,3,'height','width'])],
       [h.make_tensor_value_info('output',T.FLOAT,[1,3,'output_height','output_width'])],
       initializers+([nh.from_array(np.array([0,0,0,3,4],np.int64),'groups')] if native else []))
    model=h.make_model(graph,opset_imports=[h.make_opsetid('',17)],ir_version=9)
    model.doc_string='Qualcomm QuickSRNet Medium 2x; official FP32 weights, BSD-3-Clause. Native tail modification disclosed.'
    onnx.checker.check_model(model)
    # Check serialized tensor values against every official learned parameter.
    packed={t.name:nh.to_array(t) for t in graph.initializer}
    assert all(np.array_equal(value,packed[name]) for name,value in weights.items())
    name='quicksrnet-medium-native-v14.onnx' if native else 'quicksrnet-medium-2x-v14.onnx'
    path=ROOT/'public/models/video-enhancer'/name
    onnx.save(model,path)
    print(name,hashlib.sha256(path.read_bytes()).hexdigest())

print('official checkpoint',hashlib.sha256(SOURCE.read_bytes()).hexdigest())
package(False);package(True)

# QuickSRNet clips EVERY activation to [0,1]. Its exact known range supplies
# activation quantization without private calibration images. Quantize only
# CPU; GPU SPAN remains reference FP32. Rounding introduces disclosed error.
qnodes=[];qinits=[nh.from_array(np.array(1/255,np.float32),'activation_scale'),
                 nh.from_array(np.array(0,np.uint8),'activation_zero')]
previous='input'
for i,base in enumerate([f'cnn.{j}' for j in range(0,12,2)]+['conv_last']):
    w,b=weights[base+'.weight'],weights[base+'.bias']
    scale=np.maximum(np.abs(w).max(axis=(1,2,3))/127,np.finfo(np.float32).tiny).astype(np.float32)
    quantized=np.clip(np.rint(w/scale[:,None,None,None])+128,1,255).astype(np.uint8)
    bias=np.rint(b/(np.float32(1/255)*scale))
    assert np.abs(bias).max()<2**31
    assert np.all(np.abs((quantized.astype(np.float32)-128)*scale[:,None,None,None]-w)<=scale[:,None,None,None]*.501)
    for suffix,value in [('weight',quantized),('scale',scale),('zero',np.full(w.shape[0],128,np.uint8)),('bias',bias.astype(np.int32))]:
        qinits.append(nh.from_array(value,base+'.'+suffix))
    out=f'quantized{i}'
    qnodes.append(h.make_node('QLinearConv',[previous,'activation_scale','activation_zero',base+'.weight',base+'.scale',base+'.zero',
      'activation_scale','activation_zero',base+'.bias'],[out],pads=[1,1,1,1],kernel_shape=[3,3]))
    previous=out

for native in [False,True]:
    if native:
        tail=[h.make_node('Cast',[previous],['native_float'],to=T.FLOAT),
          h.make_node('Transpose',['native_float'],['nhwc'],perm=[0,2,3,1]),
          h.make_node('Reshape',['nhwc','groups'],['subpixels']),
          h.make_node('ReduceMean',['subpixels'],['mean'],axes=[4],keepdims=0),
          h.make_node('Transpose',['mean'],['nchw'],perm=[0,3,1,2]),
          h.make_node('Round',['nchw'],['rounded']),h.make_node('Cast',['rounded'],['output'],to=T.UINT8)]
    else: tail=[h.make_node('DepthToSpace',[previous],['output'],blocksize=2,mode='CRD')]
    graph=h.make_graph(qnodes+tail,'QuickSRNetMediumCPUUint8',
      [h.make_tensor_value_info('input',T.UINT8,[1,3,'height','width'])],
      [h.make_tensor_value_info('output',T.UINT8,[1,3,'output_height','output_width'])],
      qinits+([nh.from_array(np.array([0,0,0,3,4],np.int64),'groups')] if native else []))
    model=h.make_model(graph,opset_imports=[h.make_opsetid('',17)],ir_version=9)
    model.doc_string='Qualcomm QuickSRNet Medium 2x. Application post-training uint8 conversion, known clipped activation range, per-channel weights; CPU only.'
    onnx.checker.check_model(model)
    path=ROOT/'public/models/video-enhancer'/('quicksrnet-medium-native-q8-v14.onnx' if native else 'quicksrnet-medium-2x-q8-v14.onnx')
    onnx.save(model,path);print(path.name,hashlib.sha256(path.read_bytes()).hexdigest())
