import sys, numpy as np
a = np.fromfile(sys.argv[1], dtype=np.float32); n = int(round((a.size / 3) ** 0.5))
np.save(sys.argv[1].replace(".raw", ".npy"), a.reshape(n, n, 3))
