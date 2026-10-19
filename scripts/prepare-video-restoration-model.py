"""Convert the upstream FSRCNN x2 frozen weights without TensorFlow.

Build-time only. Requires numpy, onnx, onnxconverter-common. No training or
inference is performed. Original architecture/weights: Xavier Weber (Saafke),
Apache-2.0. See public/models/video-enhancer/FSRCNN-LICENSE.txt.
"""
from pathlib import Path
import hashlib
import struct
from urllib.request import urlretrieve
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto
from onnxconverter_common import float16

ROOT=Path(__file__).resolve().parents[1]
SOURCE_URL='https://raw.githubusercontent.com/Saafke/FSRCNN_Tensorflow/master/models/FSRCNN_x2.pb'
SOURCE=ROOT/'.cache/fsrcnn-x2.pb'

def fields(b):
    p=0
    def varint():
        nonlocal p
        n=0; shift=0
        while True:
            v=b[p];p+=1;n|=(v&127)<<shift
            if v<128:return n
            shift+=7
    while p<len(b):
        key=varint();field=key>>3;wire=key&7
        if wire==0:value=varint()
        elif wire==2:
            size=varint();value=b[p:p+size];p+=size
        elif wire==5:value=b[p:p+4];p+=4
        elif wire==1:value=b[p:p+8];p+=8
        else:raise ValueError(f'Unsupported protobuf wire {wire}')
        yield field,value

def first(b,n,default=None):return next((v for f,v in fields(b) if f==n),default)

def main():
    SOURCE.parent.mkdir(parents=True,exist_ok=True)
    if not SOURCE.exists():urlretrieve(SOURCE_URL,SOURCE)
    tensors={}
    for f,node in fields(SOURCE.read_bytes()):
        if f!=1 or first(node,2)!=b'Const':continue
        name=first(node,1).decode()
        attrs={first(v,1).decode():first(v,2) for f,v in fields(node) if f==5}
        tensor=first(attrs['value'],8)
        if first(tensor,1)!=1:continue
        dims=[first(v,1) for f,v in fields(first(tensor,2,b'')) if f==2]
        data=first(tensor,4)
        if data is None:data=b''.join(v for f,v in fields(tensor) if f==5)
        values=np.frombuffer(data,dtype='<f4').copy()
        count=int(np.prod(dims)) if dims else 1
        if len(values)==1 and count>1:values=np.full(count,values[0],dtype=np.float32)
        tensors[name]=values.reshape(dims)
    nodes=[];initializers=[];previous='input'
    for i in range(1,9):
        weights=tensors[f'f{i}'].transpose(3,2,0,1).copy()
        kernel=list(weights.shape[2:]);pad=[v//2 for v in kernel]*2
        w=f'w{i}';initializers.append(numpy_helper.from_array(weights,w))
        inputs=[previous,w]
        if i<8:
            b=f'b{i}';initializers.append(numpy_helper.from_array(tensors[b],b));inputs.append(b)
        out=f'conv{i}'
        nodes.append(helper.make_node('Conv',inputs,[out],kernel_shape=kernel,pads=pad))
        if i<8:
            a=f'a{i}';initializers.append(numpy_helper.from_array(tensors[f'alpha{i}'].reshape(-1,1,1),a))
            previous=f'act{i}';nodes.append(helper.make_node('PRelu',[out,a],[previous]))
        else:previous=out
    nodes.append(helper.make_node('DepthToSpace',[previous],['shuffled'],blocksize=2,mode='DCR'))
    initializers.append(numpy_helper.from_array(tensors['b8'].reshape(1,1,1,1),'output_bias'))
    nodes.append(helper.make_node('Add',['shuffled','output_bias'],['output']))
    graph=helper.make_graph(nodes,'FSRCNN_native_2x_luma',
        [helper.make_tensor_value_info('input',TensorProto.FLOAT,[1,1,'height','width'])],
        [helper.make_tensor_value_info('output',TensorProto.FLOAT,[1,1,'output_height','output_width'])],initializers)
    model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',17)],producer_name='CUTWEAVE FSRCNN weight conversion')
    model.ir_version=8
    folder=ROOT/'public/models/video-enhancer';folder.mkdir(parents=True,exist_ok=True)
    onnx.save(model,folder/'fsrcnn-2x.onnx')
    onnx.save(float16.convert_float_to_float16(model,keep_io_types=True),folder/'fsrcnn-2x-fp16.onnx')
    print('Converted upstream weights; source SHA256:',hashlib.sha256(SOURCE.read_bytes()).hexdigest())
    print('Parameters:',sum(int(np.prod(t.dims)) for t in initializers))
if __name__=='__main__':main()
