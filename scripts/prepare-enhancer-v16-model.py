"""Keep the author's FP16 SPAN head native to GPU buffers. No inference.

No weight, normalization or learned computation changes. Remove only the
application's v15 FP32 IO casts; the GPU input/output shaders own those casts.
"""
from pathlib import Path
import hashlib
import onnx
from onnx import TensorProto as T

root=Path(__file__).resolve().parents[1]
model=onnx.load(root/'public/models/video-enhancer/nomosuni-span-head-author-fp16-v15.onnx')
first,last=model.graph.node[0],model.graph.node[-1]
assert first.name=='ApplicationInputCast' and last.name=='ApplicationHeadCast'
assert first.op_type==last.op_type=='Cast'
preserved=[n.SerializeToString() for n in list(model.graph.node)[1:-1]]
model.graph.input[0].name=first.output[0]
model.graph.input[0].type.tensor_type.elem_type=T.FLOAT16
model.graph.output[0].name=last.input[0]
model.graph.output[0].type.tensor_type.elem_type=T.FLOAT16
del model.graph.node[-1];del model.graph.node[0]
assert preserved==[n.SerializeToString() for n in model.graph.node]
onnx.checker.check_model(model,full_check=True)
model.graph.input[0].type.tensor_type.shape.dim[2].dim_value=64
model.graph.input[0].type.tensor_type.shape.dim[3].dim_value=80
check=onnx.shape_inference.infer_shapes(model,strict_mode=True,data_prop=True)
assert [d.dim_value for d in check.graph.output[0].type.tensor_type.shape.dim]==[1,12,64,80]
model.graph.input[0].type.tensor_type.shape.dim[2].dim_param='height'
model.graph.input[0].type.tensor_type.shape.dim[3].dim_param='width'
path=root/'public/models/video-enhancer/nomosuni-span-head-author-fp16-io-v16.onnx'
onnx.save(model,path)
print(path.name,hashlib.sha256(path.read_bytes()).hexdigest(),path.stat().st_size)
print(len(preserved),'author head nodes unchanged; FP16 GPU IO; no model execution')
