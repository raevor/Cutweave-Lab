"""Expose the unchanged author's FP32 subpixel head for fused GPU reconstruction.

No learned node/weight changes. Clip/pixel shuffle/native reduction move into
the GPU output shader. Both output sizes use the original learned prediction.
"""
from pathlib import Path
import hashlib
import onnx
from onnx import helper, TensorProto, numpy_helper

root=Path(__file__).resolve().parents[1]
model=onnx.load(root/'.cache/span/author-span-fp32.onnx')
shuffle=next(n for n in model.graph.node if n.op_type=='DepthToSpace')
clip=next(n for n in model.graph.node if n.op_type=='Clip' and n.output[0]=='output')
assert clip.input[0]==shuffle.output[0]
assert next(a.i for a in shuffle.attribute if a.name=='blocksize')==2
assert next(a.s for a in shuffle.attribute if a.name=='mode')==b'CRD'
for name,expected in zip(clip.input[1:],[0.0,1.0]):
    value=next((t for t in model.graph.initializer if t.name==name),None)
    if value is None:
        value=next(a.t for n in model.graph.node if name in n.output for a in n.attribute if a.name=='value')
    assert float(numpy_helper.to_array(value))==expected
retained=[n for n in model.graph.node if n not in (shuffle,clip)]
serialized=[n.SerializeToString() for n in retained]
del model.graph.node[:];model.graph.node.extend(retained)
del model.graph.output[:]
model.graph.output.append(helper.make_tensor_value_info(shuffle.input[0],TensorProto.FLOAT,[1,12,'height','width']))
assert serialized==[n.SerializeToString() for n in model.graph.node]
onnx.checker.check_model(model)
path=root/'public/models/video-enhancer/nomosuni-span-head-fp32-v14.onnx'
onnx.save(model,path)
print('head output',shuffle.input[0])
print('unchanged learned nodes',len(serialized))
print(path.name,hashlib.sha256(path.read_bytes()).hexdigest())
