# Rot Wars multiplayer — Windows setup kit

Run one fly-brain model on each player's own PC and connect those individual flies to the same shared 3D world.

## Download and join

1. Download **Rot-Wars-Multiplayer-Windows.zip** from [the latest release](https://github.com/markjspivey-xwisee/rot-wars-multiplayer/releases/latest).
2. Extract the entire archive into a folder with several GB of free space.
3. Install Python 3.11 and Node.js 22 from their official websites if needed.
4. Run **Setup Multiplayer.cmd**, then **Start Multiplayer.cmd**.
5. Select **Join a world** and paste the invitation supplied by the world host.

The tested configuration is Windows and an NVIDIA GTX 980 Ti. The kit pins PyTorch 2.5.1 with CUDA 12.1; newer GPUs may require a newer PyTorch build. A new computer's installation has not yet been verified.

The world host must stay online. Each participant's neural state and learned memory stay on their own computer. The kit contains no host credentials or participant memories.

## Model and scope

This is coarse browser embodiment with an engineered sensory interface, motor decoder, and experimental learning rule. It is not a complete biological fly simulation, a claim of consciousness, or proof of the software a remote participant runs.

The included community model derives from [erojasoficial-byte/fly-brain](https://github.com/erojasoficial-byte/fly-brain), revision `27cec28d5d202eb004683fb4c1a1033eec8deea0`, with local compatibility changes. The upstream MIT license is preserved in the archive.
