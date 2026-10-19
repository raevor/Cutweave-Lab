"""Tiny synthetic head/packing identities only; no media or model inference."""
import numpy as np

head=np.resize(np.array([-2,-.01,0,.125,.5,.99,1,1.25],np.float32),(1,12,3,5))
clipped=np.clip(head,0,1)
reference=clipped.reshape(1,3,2,2,3,5).transpose(0,1,4,2,5,3).reshape(1,3,6,10)
for c in range(3):
    for y in range(6):
        for x in range(10):
            direct=clipped[0,c*4+(y%2)*2+x%2,y//2,x//2]
            assert direct==reference[0,c,y,x]
native=clipped.reshape(1,3,4,3,5).mean(axis=2)
area=reference.reshape(1,3,3,2,5,2).mean(axis=(3,5))
assert np.allclose(native,area,rtol=0,atol=1e-7)

quantized=np.rint(clipped*255).astype(np.uint8)
qnative=np.rint(quantized.reshape(1,3,4,3,5).astype(np.float32).mean(axis=2)).astype(np.uint8)
qshuffle=quantized.reshape(1,3,2,2,3,5).transpose(0,1,4,2,5,3).reshape(1,3,6,10)
qarea=np.rint(qshuffle.reshape(1,3,3,2,5,2).astype(np.float32).mean(axis=(3,5))).astype(np.uint8)
assert np.array_equal(qnative,qarea)

# NV12 uses little-endian u32 storage writes: byte order must match VideoFrame.
bytes_=np.array([[16,235,128,240],[0,1,127,255],[255,0,32,64]],np.uint32)
words=bytes_[:,0]|(bytes_[:,1]<<8)|(bytes_[:,2]<<16)|(bytes_[:,3]<<24)
assert np.array_equal(np.frombuffer(words.astype('<u4').tobytes(),np.uint8).reshape(-1,4),bytes_)
print('CRD mapping, clipped native reduction, CPU byte-native reduction and NV12 word order pass; no model inference run')
