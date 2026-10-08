"""Assemble a narrated demo from actual integrated-browser captures (local only)."""
import argparse
import bisect
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPTURE = ROOT / "artifacts" / "video-2026-10-08"
OUTPUT = ROOT / "artifacts" / "Lunar-Horizon-demonstracao-90s.mp4"
sys.path.insert(0, str(ROOT / "artifacts" / "video-tools"))
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 30
DURATION = 90.5
SCENES = [
    (0, 8, "LUNAR HORIZON 3D", "Explore o polo sul lunar: relevo, luz solar e visada para a Terra.",
     "Conheça o Lunar Horizon: uma ferramenta para explorar iluminação e comunicação no polo sul da Lua."),
    (8, 16, "1 · ESCOLHA A DATA E COMPARE OS LOCAIS", "02/10/2026 · 12:00 UTC | Shackleton + Malapert | observador: 2 m",
     "Escolha a data em UTC e compare até três locais. Aqui usamos Shackleton e Malapert, com observador a dois metros."),
    (16, 24, "2 · LEIA A MARGEM SOBRE O HORIZONTE", "Shackleton: Sol obstruído, 0 W/m². Terra visível: margem +7,20°.",
     "Em Shackleton, o relevo bloqueia o Sol. A irradiância é zero. O gráfico compara luz e visada para a Terra."),
    (24, 32, "3 · ENCONTRE UMA JANELA COMUM", "22/10 · 18:00 UTC → 29/10 · 00:00 UTC | 150 h estimadas",
     "Melhor janela encontra cento e cinquenta horas comuns entre os locais, de vinte e dois a vinte e nove de outubro."),
    (32, 40, "4 · CONFIGURE A MISSÃO", "Ida: 72 h | Solo lunar: 24 h | Volta: 72 h | animação: 2×",
     "Abra Simular missão. São setenta e duas horas de ida, vinte e quatro no solo e setenta e duas de volta."),
    (40, 45, "5 · LANÇAMENTO DA TERRA", "19/10/2026 · 18:00 UTC | início da missão ilustrativa",
     "A missão parte da Terra em dezenove de outubro, às dezoito horas UTC."),
    (45, 57, "6 · TRAJETÓRIA ATÉ A LUA", "A animação mira a posição da Lua na data do pouso.",
     "Acompanhe o veículo na viagem até a Lua. A animação considera a posição lunar na chegada, enquanto o relógio mostra o tempo simulado."),
    (57, 64.5, "7 · DESCIDA E POUSO LUNAR", "22/10/2026 · 18:00 UTC | Borda de Shackleton | terreno LOLA",
     "O pouso acontece no início da janela escolhida. A câmera se aproxima do terreno lunar, reconstruído com dados LOLA."),
    (64.5, 69.5, "8 · PERMANÊNCIA NO SOLO", "24 h no destino | Sol + Terra em 25/25 amostras de até 1 h",
     "A permanência é de vinte e quatro horas. As amostras indicam Sol e Terra visíveis."),
    (69.5, 76.5, "9 · DECOLAGEM DA LUA", "23/10/2026 · 18:00 UTC | início da viagem de volta",
     "Em vinte e três de outubro, o veículo decola da Lua e começa a viagem de volta à Terra."),
    (76.5, 87, "10 · RETORNO À TERRA", "Curvas educativas: não há integração gravitacional ou validação orbital.",
     "O retorno dura setenta e duas horas simuladas. Atenção: a janela é de iluminação e visada. Esta animação educativa não valida órbitas nem lançamentos reais."),
    (87, 90.5, "11 · CHEGADA À TERRA", "26/10/2026 · 18:00 UTC | demonstração concluída, inteiramente local",
     "Chegada à Terra. Demonstração concluída."),
]


def ass_time(seconds):
    centis = round(seconds * 100)
    return f"{centis // 360000}:{centis // 6000 % 60:02}:{centis // 100 % 60:02}.{centis % 100:02}"


def prepare():
    segments = json.loads((CAPTURE / "capture.json").read_text(encoding="utf-8"))
    assert len(segments) == 6, "Expected five UI segments and one complete mission capture"
    concat = ["ffconcat version 1.0"]
    selected = []
    for index, segment in enumerate(segments):
        target = 8 if index < 5 else 50.5
        times = [frame["time"] for frame in segment["frames"]]
        for tick in range(round(target * FPS)):
            source_time = tick / FPS * segment["duration"] / target
            pos = max(0, bisect.bisect_right(times, source_time) - 1)
            name = segment["frames"][pos]["file"]
            concat.extend([f"file '{name}'", f"duration {1 / FPS:.9f}"])
            selected.append(name)
    concat.append(f"file '{selected[-1]}'")
    (CAPTURE / "frames.ffconcat").write_text("\n".join(concat), encoding="utf-8")
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1150
PlayResY: 1040
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Segoe UI,23,&H00FFFFFF,&H00FFFFFF,&H00120E0A,&H00120E0A,0,0,0,0,100,100,0,0,1,0,0,8,24,24,0,1
Style: Meta,Segoe UI,13,&H009EADAF,&H009EADAF,&H00120E0A,&H00120E0A,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    lines.append("Dialogue: 0,0:00:00.00,0:01:30.50,Meta,,0,0,0,,{\\pos(24,927)}CAPTURA DO NAVEGADOR INTEGRADO · LOCALHOST · NARRAÇÃO EM PORTUGUÊS")
    plan = []
    srt = []
    for index, (start, end, title, subtitle, speech) in enumerate(SCENES):
        text = "{\\pos(575,950)\\b1\\c&H0057FFE6&}" + title + "{\\b0\\c&H00FFFFFF&}\\N" + subtitle
        lines.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Main,,0,0,0,,{text}")
        plan.append({"start": start, "end": end, "text": speech, "wav": f"speech-{index:02}.wav"})
        def srt_time(t):
            millis = round(t * 1000)
            return f"{millis//3600000:02}:{millis//60000%60:02}:{millis//1000%60:02},{millis%1000:03}"
        srt.append(f"{index+1}\n{srt_time(start)} --> {srt_time(end)}\n{title}\n{subtitle}\n")
    (CAPTURE / "captions.ass").write_text("\n".join(lines), encoding="utf-8-sig")
    (OUTPUT.with_suffix(".srt")).write_text("\n".join(srt), encoding="utf-8-sig")
    (CAPTURE / "narration.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8-sig")
    print(json.dumps({"duration": DURATION, "frames": len(selected), "capture_frames": sum(len(s['frames']) for s in segments), "output": str(OUTPUT)}))


def render():
    plan = json.loads((CAPTURE / "narration.json").read_text(encoding="utf-8-sig"))
    with wave.open(str(CAPTURE / plan[0]["wav"]), "rb") as first:
        params = first.getparams()
    assert params.sampwidth == 2 and params.nchannels == 1
    mix = bytearray(math.ceil(DURATION * params.framerate) * 2)
    for item in plan:
        with wave.open(str(CAPTURE / item["wav"]), "rb") as source:
            assert source.getparams()[:3] == params[:3]
            data = source.readframes(source.getnframes())
        available = item["end"] - item["start"] - 0.12
        seconds = len(data) / 2 / params.framerate
        if seconds > available:
            ratio = min(2, seconds / available)
            adjusted = CAPTURE / (item["wav"].replace(".wav", "-paced.wav"))
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(CAPTURE / item["wav"]), "-af", f"atempo={ratio:.6f}", str(adjusted)], check=True)
            with wave.open(str(adjusted), "rb") as source:
                data = source.readframes(source.getnframes())
        offset = round(item["start"] * params.framerate) * 2
        limit = round((item["end"] - 0.04) * params.framerate) * 2
        data = data[:max(0, limit - offset)]
        mix[offset:offset + len(data)] = data
    with wave.open(str(CAPTURE / "narration.wav"), "wb") as target:
        target.setparams(params)
        target.writeframes(mix)
    command = [FFMPEG, "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", "frames.ffconcat", "-i", "narration.wav",
               "-vf", "pad=1150:1040:0:0:color=0x0a0e12,ass=captions.ass", "-t", str(DURATION), "-r", str(FPS), "-fps_mode", "cfr",
               "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
               "-movflags", "+faststart", "-metadata", "title=Lunar Horizon — demonstração e simulação Terra–Lua–Terra",
               "-metadata", "comment=Capturas reais do navegador integrado em localhost. Simulação educativa, não orbital.", str(OUTPUT)]
    with (CAPTURE / "encode.log").open("w", encoding="utf-8") as log:
        subprocess.run(command, cwd=CAPTURE, stderr=log, stdout=log, check=True)
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["prepare", "render"])
    arguments = parser.parse_args()
    prepare() if arguments.mode == "prepare" else render()
