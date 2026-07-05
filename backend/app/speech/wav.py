from __future__ import annotations
import io
import wave
from dataclasses import dataclass
from .base import SpeechProviderError

@dataclass(frozen=True)
class WavInfo:
    channels: int
    sample_rate: int
    sample_width: int
    frame_count: int
    @property
    def duration_ms(self) -> int:
        return round(self.frame_count * 1000 / self.sample_rate)

def inspect_wav(audio: bytes) -> WavInfo:
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            info = WavInfo(source.getnchannels(), source.getframerate(), source.getsampwidth(), source.getnframes())
    except (wave.Error, EOFError) as error:
        raise SpeechProviderError("ASR_INVALID_AUDIO", "录音不是有效的 WAV 文件") from error
    if info.channels != 1 or info.sample_rate != 16000 or info.sample_width != 2:
        raise SpeechProviderError("ASR_INVALID_AUDIO", "录音必须是 16 kHz、16-bit、单声道 PCM WAV")
    if info.frame_count == 0:
        raise SpeechProviderError("ASR_EMPTY_AUDIO", "没有录到声音")
    return info

def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(pcm)
    return output.getvalue()
