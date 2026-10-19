"""Package the author's FP32 2x ONNX and its equivalent native-output tail.

Philip Hofmann, 2xNomosUni_span_multijpg, CC BY 4.0. No weight, attention,
normalization, concat or precision changes. The 2x graph keeps all nodes.
The native graph only changes the Clip/pixel-shuffle/reduction tail.
The original export labels
both input and 2x output with the same symbolic height/width names.
"""
from pathlib import Path
import hashlib
import onnx
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.cache/span/author-span-fp32.onnx'
model = onnx.load(SOURCE)
before = [node.SerializeToString() for node in model.graph.node]
shape = model.graph.output[0].type.tensor_type.shape.dim
shape[2].dim_param = 'output_height'
shape[3].dim_param = 'output_width'
assert before == [node.SerializeToString() for node in model.graph.node]
onnx.checker.check_model(model)
target = ROOT / 'public/models/video-enhancer/nomosuni-span-author-fp32-v12.onnx'
onnx.save(model, target)
print('source', hashlib.sha256(SOURCE.read_bytes()).hexdigest())
print('packaged', hashlib.sha256(target.read_bytes()).hexdigest())

# Source-size inference: commute Clip before pixel shuffle, then average the
# four clipped subpixels per RGB channel. This is the existing source-size
# area reduction, without materializing the 2x image/tensor. All CNN nodes and
# weights remain identical. Keep Clip BEFORE the mean (not mean then Clip).
from onnx import helper, numpy_helper
import numpy as np
native = onnx.load(target)
shuffle = next(n for n in native.graph.node if n.op_type == 'DepthToSpace')
clip = next(n for n in native.graph.node if n.op_type == 'Clip' and n.output[0] == 'output')
assert clip.input[0] == shuffle.output[0]
preserved = [n.SerializeToString() for n in native.graph.node if n.name not in (shuffle.name, clip.name)]
remaining = [n for n in native.graph.node if n.name not in (shuffle.name, clip.name)]
del native.graph.node[:]
native.graph.node.extend(remaining)
native.graph.initializer.append(numpy_helper.from_array(np.array([0,0,0,3,4],dtype=np.int64),'native_group_shape'))
native.graph.node.extend([
 helper.make_node('Clip',[shuffle.input[0],*clip.input[1:]],['native_clipped'],name='NativeClip'),
 helper.make_node('Transpose',['native_clipped'],['native_nhwc'],perm=[0,2,3,1],name='NativeChannels'),
 helper.make_node('Reshape',['native_nhwc','native_group_shape'],['native_subpixels'],name='NativeGroups'),
 helper.make_node('ReduceMean',['native_subpixels'],['native_mean'],axes=[4],keepdims=0,name='NativeMean'),
 helper.make_node('Transpose',['native_mean'],['output'],perm=[0,3,1,2],name='NativeOutput'),
])
assert preserved == [n.SerializeToString() for n in list(native.graph.node)[:-5]]
onnx.checker.check_model(native)
native_target=ROOT/'public/models/video-enhancer/nomosuni-span-author-native-v13.onnx'
onnx.save(native,native_target)
print('native',hashlib.sha256(native_target.read_bytes()).hexdigest())

# Validate the native-tail identity on signed/out-of-range channel values.
# This is arithmetic on a tiny synthetic head, not model/media inference.
values=np.resize(np.array([-1,.125,.25,.5,.75,1,2],dtype=np.float32),(1,12,3,5))
clipped=np.clip(values,0,1)
shuffled=clipped.reshape(1,3,2,2,3,5).transpose(0,1,4,2,5,3).reshape(1,3,6,10)
old_native=shuffled.reshape(1,3,3,2,5,2).mean(axis=(3,5))
new_native=clipped.transpose(0,2,3,1).reshape(1,3,5,3,4).mean(axis=4).transpose(0,3,1,2)
assert np.array_equal(old_native,new_native)
print('native reduction identity validated; learned model not executed')
