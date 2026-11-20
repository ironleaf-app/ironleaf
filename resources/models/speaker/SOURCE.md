# Speaker models (ONNX, run on this PC only)

Telling the speakers apart in a recorded meeting (6 Nov 2026). Both are sherpa-onnx's released exports (https://github.com/k2-fsa/sherpa-onnx), run on WebAssembly
through onnxruntime-web; nothing is uploaded and nothing about a voice is kept. Licence texts beside them.

- segmentation-3-0-int8.onnx (1.5 MB): who speaks when in each 10-second window. Export of
  pyannote/segmentation-3.0 (https://huggingface.co/pyannote/segmentation-3.0), release
  speaker-segmentation-models, file sherpa-onnx-pyannote-segmentation-3-0.tar.bz2. Licence: MIT (CNRS).
  sha256 d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d
- campplus-zh-en-advanced.onnx (28.3 MB): what each voice sounds like (192-wide voiceprint). Export of
  iic/speech_campplus_sv_zh_en_16k-common_advanced (https://www.modelscope.cn/models/iic/speech_campplus_sv_zh_en_16k-common_advanced/summary),
  release speaker-recongition-models. Chosen over the English-only VoxCeleb export after measuring both on real
  meeting voices (6 Nov 2026): same-voice likeness never under 0.61 and cross-voice never over 0.33, where the
  English-only one overlapped (0.22 against 0.64). Licence: Apache-2.0 (3D-Speaker, Alibaba DAMO).
  sha256 aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2
