"""Package true 1x RTMoSR Light and the SPAN author's own FP16 export.

Weights: TNTwise DeH264 RTMoSR Light / Philip Hofmann NomosUni SPAN,
CC BY 4.0. RTMoSR architecture rewaifu, MIT. No media/inference is used.
Native graph follows RTMoSR_L(scale=1), including CRD rearrangement,
RMSNorm epsilon outside sqrt, spatial channel attention and residual input.
"""
from pathlib import Path
import hashlib, json, struct
import numpy as np
import onnx
from onnx import helper as h, numpy_helper as nh, TensorProto as T

ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.cache/enhancer-v15'
DEST=ROOT/'public/models/video-enhancer'

def save(model,name):
    onnx.checker.check_model(model)
    path=DEST/name;onnx.save(model,path)
    print(name,hashlib.sha256(path.read_bytes()).hexdigest(),path.stat().st_size)

# Keep the author's half-precision computation, not the old custom conversion.
half=onnx.load(CACHE/'span-author-fp16.onnx')
shuffle=next(n for n in half.graph.node if n.op_type=='DepthToSpace')
clip=next(n for n in half.graph.node if n.op_type=='Clip' and n.output[0]==half.graph.output[0].name)
assert clip.input[0]==shuffle.output[0]
assert next(a.s for a in shuffle.attribute if a.name=='mode')==b'CRD'
assert half.graph.input[0].type.tensor_type.elem_type==T.FLOAT16
kept=[n for n in half.graph.node if n not in (shuffle,clip)]
before=[n.SerializeToString() for n in kept]
del half.graph.node[:];half.graph.node.extend(kept)
original_input=half.graph.input[0].name
half.graph.input[0].name='float_input';half.graph.input[0].type.tensor_type.elem_type=T.FLOAT
half.graph.node.insert(0,h.make_node('Cast',['float_input'],[original_input],to=T.FLOAT16,name='ApplicationInputCast'))
half.graph.node.append(h.make_node('Cast',[shuffle.input[0]],['output'],to=T.FLOAT,name='ApplicationHeadCast'))
del half.graph.output[:];half.graph.output.append(h.make_tensor_value_info('output',T.FLOAT,[1,12,'height','width']))
assert before==[n.SerializeToString() for n in list(half.graph.node)[1:-1]]
save(half,'nomosuni-span-head-author-fp16-v15.onnx')
print('author FP16 source',hashlib.sha256((CACHE/'span-author-fp16.onnx').read_bytes()).hexdigest())

raw=(CACHE/'native.safetensors').read_bytes();length=struct.unpack('<Q',raw[:8])[0]
header=json.loads(raw[8:8+length]);data=raw[8+length:]
weights={}
for name,entry in header.items():
    if name=='__metadata__':continue
    assert entry['dtype']=='F32'
    a,b=entry['data_offsets'];value=np.frombuffer(data[a:b],'<f4').reshape(entry['shape']).copy()
    assert np.isfinite(value).all();weights[name]=value

nodes=[];initializers=[];serial=0
def const(value,name=None,dtype=np.float32):
    global serial
    serial+=1;name=name or f'constant{serial}'
    initializers.append(nh.from_array(np.asarray(value,dtype=dtype),name));return name
def op(kind,inputs,**attrs):
    global serial
    serial+=1;name=f'{kind}{serial}';nodes.append(h.make_node(kind,inputs,[name],name=name,**attrs));return name
def pad_kernel(w,amount):return np.pad(w,((0,0),(0,0),(amount,amount),(amount,amount)))
def fused_rep(prefix):
    # Upstream SeqConv3x3.rep_params and Conv3XC.update_params, then RepConv.fuse.
    a=weights[prefix+'.alpha']
    k0=weights[prefix+'.conv1.k0'][:,:,0,0];k1=weights[prefix+'.conv1.k1']
    seq=np.einsum('omhw,mi->oihw',k1,k0,optimize=True)
    seq_b=np.einsum('omhw,m->o',k1,weights[prefix+'.conv1.b0'],optimize=True)+weights[prefix+'.conv1.b1']
    w1=weights[prefix+'.conv3.conv.0.weight'][:,:,0,0];b1=weights[prefix+'.conv3.conv.0.bias']
    w2=weights[prefix+'.conv3.conv.1.weight'];b2=weights[prefix+'.conv3.conv.1.bias']
    w3=weights[prefix+'.conv3.conv.2.weight'][:,:,0,0];b3=weights[prefix+'.conv3.conv.2.bias']
    first=np.einsum('omhw,mi->oihw',w2,w1,optimize=True)
    third=np.einsum('om,mihw->oihw',w3,first,optimize=True)+pad_kernel(weights[prefix+'.conv3.sk.weight'],1)
    third_b=w3@(np.einsum('omhw,m->o',w2,b1,optimize=True)+b2)+b3+weights[prefix+'.conv3.sk.bias']
    w=a[0]*seq+a[1]*weights[prefix+'.conv2.weight']+a[2]*third
    b=a[0]*seq_b+a[1]*weights[prefix+'.conv2.bias']+a[2]*third_b
    assert np.isfinite(w).all() and np.isfinite(b).all()
    return w,b
def conv(x,w,b,group=1):
    size=w.shape[-1];pad=size//2
    return op('Conv',[x,const(w),const(b)],kernel_shape=[size,size],pads=[pad]*4,group=group)
def rep(x,prefix):return conv(x,*fused_rep(prefix))
def learned_conv(x,prefix):return conv(x,weights[prefix+'.weight'],weights[prefix+'.bias'])
def unshuffle(x,channels,factor):
    # CRD PixelUnshuffle via reshape/transpose. ORT WebGPU does not register
    # SpaceToDepth. Fixed session dimensions let ORT fold the shape arithmetic.
    shape=op('Shape',[x]);n=op('Gather',[shape,const([0],dtype=np.int64)],axis=0)
    height=op('Div',[op('Gather',[shape,const([2],dtype=np.int64)],axis=0),const([factor],dtype=np.int64)])
    width=op('Div',[op('Gather',[shape,const([3],dtype=np.int64)],axis=0),const([factor],dtype=np.int64)])
    group=op('Concat',[n,const([channels],dtype=np.int64),height,const([factor],dtype=np.int64),width,const([factor],dtype=np.int64)],axis=0)
    grouped=op('Reshape',[x,group]);ordered=op('Transpose',[grouped],perm=[0,1,3,5,2,4])
    final=op('Concat',[n,const([channels*factor*factor],dtype=np.int64),height,width],axis=0)
    return op('Reshape',[ordered,final])
def mish(x):
    # Stable softplus using registered WebGPU operators; avoid exp overflow.
    positive=op('Relu',[x])
    softplus=op('Add',[positive,op('Log',[op('Add',[const(1),op('Exp',[op('Neg',[op('Abs',[x])])])])])])
    return op('Mul',[x,op('Tanh',[softplus])])

x=rep(unshuffle('input',3,4),'to_feat.1')
for index in range(2):
    prefix=f'body.{index}';shortcut=x
    squares=op('Mul',[x,x]);summed=op('ReduceSum',[squares,const([1],dtype=np.int64)],keepdims=1)
    denominator=op('Add',[op('Mul',[op('Sqrt',[summed]),const(32**-.5)]),const(1e-6)])
    norm=op('Div',[x,denominator])
    norm=op('Add',[op('Mul',[norm,const(weights[prefix+'.norm.scale'].reshape(1,32,1,1))]),const(weights[prefix+'.norm.offset'].reshape(1,32,1,1))])
    combined=rep(norm,prefix+'.fc1')
    names=[f'g{index}',f'i{index}',f'c{index}']
    nodes.append(h.make_node('Split',[combined,const([64,32,32],dtype=np.int64)],names,axis=1))
    g,i,c=names
    pooled=op('MaxPool',[c],kernel_shape=[2,2],strides=[2,2])
    c=op('Add',[unshuffle(c,32,2),rep(pooled,prefix+'.conv.0.poll.1')])
    omni=prefix+'.conv.1'
    alphas=[weights[omni+f'.alpha{j}'].reshape(128,1,1,1) for j in range(1,5)]
    identity=np.zeros((128,1,5,5),np.float32);identity[:,:,2,2]=1
    w=alphas[0]*identity+alphas[1]*pad_kernel(weights[omni+'.conv1x1.weight'],2)+alphas[2]*pad_kernel(weights[omni+'.conv3x3.weight'],1)+alphas[3]*weights[omni+'.conv5x5.weight']
    b=sum(alphas[j].reshape(128)*weights[omni+name+'.bias'] for j,name in [(1,'.conv1x1'),(2,'.conv3x3'),(3,'.conv5x5')])
    c=conv(c,w,b,128)
    gate=op('ReduceMean',[c],axes=[2,3],keepdims=1)
    gate=op('Relu',[learned_conv(gate,prefix+'.conv.2.squeezing.0')])
    gate=op('HardSigmoid',[learned_conv(gate,prefix+'.conv.2.squeezing.2')],alpha=1/6,beta=.5)
    c=op('DepthToSpace',[op('Mul',[c,gate])],blocksize=2,mode='CRD')
    mixed=op('Mul',[mish(g),op('Concat',[i,c],axis=1)])
    x=op('Add',[mish(rep(mixed,prefix+'.fc2')),shortcut])
result=op('Add',[op('DepthToSpace',[rep(x,'to_img.0')],blocksize=4,mode='CRD'),'input'])
nodes.append(h.make_node('Clip',[result,const(0),const(1)],['output']))
graph=h.make_graph(nodes,'TNTwise_DeH264_RTMoSR_Light_1x',
 [h.make_tensor_value_info('input',T.FLOAT,[1,3,'height','width'])],
 [h.make_tensor_value_info('output',T.FLOAT,[1,3,'height','width'])],initializers)
model=h.make_model(graph,opset_imports=[h.make_opsetid('',17)],ir_version=9)
model.doc_string='TNTwise DeH264 RTMoSR Light 1x (CC BY 4.0); RTMoSR architecture MIT. Application ONNX export, upstream eval branch fusion, aligned input padding handled by the app, output clipped to [0,1].'
save(model,'deh264-rtmosr-light-native-fp32-v15.onnx')
print('native source',hashlib.sha256(raw).hexdigest())
