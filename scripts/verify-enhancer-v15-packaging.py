"""Structural checks + tiny synthetic algebra. No media/neural inference."""
from pathlib import Path
import re
import numpy as np
import onnx

root=Path(__file__).resolve().parents[1]
registry=(root/'node_modules/onnxruntime-web/lib/wasm/jsep/webgpu/op-resolve-rules.ts').read_text()
registered=set(re.findall(r"\['([A-Za-z0-9]+)'",registry))
for name,channels in [('deh264-rtmosr-light-native-fp32-v15.onnx',3),('nomosuni-span-head-author-fp16-v15.onnx',12)]:
    model=onnx.load(root/'public/models/video-enhancer'/name)
    onnx.checker.check_model(model,full_check=True)
    # Reshape is explicitly supported by ORT's WebGPU metadata kernel (no
    # shader); Shape constants fold after the session fixes input dimensions.
    unknown={node.op_type for node in model.graph.node}-registered-{'Constant','Shape','Gather','Reshape'}
    assert not unknown, unknown
    dims=model.graph.input[0].type.tensor_type.shape.dim
    dims[2].dim_value=64;dims[3].dim_value=80
    inferred=onnx.shape_inference.infer_shapes(model,strict_mode=True,data_prop=True)
    assert [d.dim_value for d in inferred.graph.output[0].type.tensor_type.shape.dim]==[1,channels,64,80]
    print(name,'shape/registered-operator checks pass')

def conv(x,w,b,padding=0):
    x=np.pad(x,((0,0),(padding,padding),(padding,padding)))
    windows=np.lib.stride_tricks.sliding_window_view(x,w.shape[-2:],axis=(1,2))
    return np.einsum('ihwxy,oixy->ohw',windows,w)+b[:,None,None]

rng=np.random.default_rng(123)
x=rng.normal(0,.1,(2,5,7)).astype(np.float32)
w1=rng.normal(0,.1,(3,2,1,1)).astype(np.float32);b1=rng.normal(0,.1,3).astype(np.float32)
w2=rng.normal(0,.1,(4,3,3,3)).astype(np.float32);b2=rng.normal(0,.1,4).astype(np.float32)
w3=rng.normal(0,.1,(2,4,1,1)).astype(np.float32);b3=rng.normal(0,.1,2).astype(np.float32)
first=np.einsum('omhw,mi->oihw',w2,w1[:,:,0,0])
fused=np.einsum('om,mihw->oihw',w3[:,:,0,0],first)
bias=w3[:,:,0,0]@(np.einsum('omhw,m->o',w2,b1)+b2)+b3
branch=conv(conv(conv(np.pad(x,((0,0),(1,1),(1,1))),w1,b1),w2,b2),w3,b3)
assert np.allclose(branch,conv(x,fused,bias,1),rtol=0,atol=2e-7)

for factor in [2,4]:
    a=np.arange(3*8*16).reshape(1,3,8,16)
    grouped=a.reshape(1,3,8//factor,factor,16//factor,factor).transpose(0,1,3,5,2,4).reshape(1,3*factor**2,8//factor,16//factor)
    roundtrip=grouped.reshape(1,3,factor,factor,8//factor,16//factor).transpose(0,1,4,2,5,3).reshape(1,3,8,16)
    assert np.array_equal(a,roundtrip)
v=np.linspace(-100,100,201)
stable=np.maximum(v,0)+np.log1p(np.exp(-np.abs(v)))
assert np.allclose(v*np.tanh(stable),v*np.tanh(np.logaddexp(0,v)),atol=1e-12)
print('synthetic eval fusion, CRD rearrangement and stable Mish identities pass; models not executed')
