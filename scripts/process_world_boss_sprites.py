#!/usr/bin/env python3
"""Build transparent WebGL sprite sheets from Google Flow contact sheets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


FRAME_WIDTH = 270
FRAME_HEIGHT = 480
SOURCE_COLUMNS = 5
SOURCE_ROWS = 5


ANIMATIONS = (
    {
        "name": "idle",
        "source": "idle-sheet-raw.png",
        "output": "idle.png",
        # Use the first half forward and backward so the coat never snaps at the loop seam.
        "frames": list(range(13)) + list(range(11, 0, -1)),
        "fps": 8,
        "loop": True,
        "events": [],
    },
    {
        "name": "darkPulse",
        "source": "dark-pulse-sheet-raw.png",
        "output": "dark-pulse.png",
        "frames": list(range(25)),
        "fps": 10,
        "loop": False,
        "events": [{"frame": 9, "name": "hit"}],
    },
    {
        "name": "darkBarrage",
        "source": "dark-barrage-sheet-raw.png",
        "output": "dark-barrage.png",
        "frames": list(range(25)),
        "fps": 10,
        "loop": False,
        "events": [
            {"frame": 6, "name": "hit1"},
            {"frame": 8, "name": "hit2"},
            {"frame": 10, "name": "hit3"},
            {"frame": 12, "name": "hit4"},
            {"frame": 14, "name": "hit5"},
        ],
    },
    {
        "name": "icham",
        "source": "icham-sheet-raw.png",
        "output": "icham.png",
        "frames": list(range(25)),
        "fps": 10,
        "loop": False,
        "events": [{"frame": 10, "name": "hit"}],
    },
    {
        "name": "curse",
        "source": "curse-sheet-raw.png",
        "output": "curse.png",
        "frames": list(range(25)),
        "fps": 8,
        "loop": False,
        "events": [{"frame": 15, "name": "apply"}],
    },
    {
        "name": "defeat",
        "source": "defeat-sheet-raw.png",
        "output": "defeat.png",
        "frames": list(range(25)),
        "fps": 8,
        "loop": False,
        "events": [{"frame": 16, "name": "settled"}],
    },
)


def split_source_sheet(path: Path) -> list[Image.Image]:
    sheet = Image.open(path).convert("RGB")
    expected_size = (FRAME_WIDTH * SOURCE_COLUMNS, FRAME_HEIGHT * SOURCE_ROWS)
    if sheet.size != expected_size:
        raise ValueError(f"{path.name}: expected {expected_size}, got {sheet.size}")

    frames: list[Image.Image] = []
    for index in range(SOURCE_COLUMNS * SOURCE_ROWS):
        column = index % SOURCE_COLUMNS
        row = index // SOURCE_COLUMNS
        frames.append(
            sheet.crop(
                (
                    column * FRAME_WIDTH,
                    row * FRAME_HEIGHT,
                    (column + 1) * FRAME_WIDTH,
                    (row + 1) * FRAME_HEIGHT,
                )
            )
        )
    return frames


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    """Fit a gentle RGB plane using only bright, neutral border pixels."""
    height, width, _ = rgb.shape
    y, x = np.mgrid[0:height, 0:width]
    border_width = 14
    border = (
        (x < border_width)
        | (x >= width - border_width)
        | (y < border_width)
        | (y >= height - border_width)
    )
    brightness = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    sample = border & (brightness > 190) & (chroma < 24)

    if sample.sum() < 100:
        median = np.median(rgb[border], axis=0)
        return np.broadcast_to(median, rgb.shape).astype(np.float32)

    xn = x[sample] / max(width - 1, 1)
    yn = y[sample] / max(height - 1, 1)
    design = np.column_stack((np.ones_like(xn), xn, yn))
    full_design = np.stack(
        (
            np.ones_like(x, dtype=np.float32),
            x / max(width - 1, 1),
            y / max(height - 1, 1),
        ),
        axis=-1,
    )

    background = np.empty_like(rgb, dtype=np.float32)
    for channel in range(3):
        coefficients, *_ = np.linalg.lstsq(design, rgb[..., channel][sample], rcond=None)
        background[..., channel] = full_design @ coefficients
    return np.clip(background, 0, 255)


def outside_reachable(passable: np.ndarray) -> np.ndarray:
    """Return passable pixels connected to the outside of the frame."""
    height, width = passable.shape
    padded = np.full((height + 2, width + 2), 255, dtype=np.uint8)
    padded[1:-1, 1:-1] = np.where(passable, 255, 0).astype(np.uint8)
    # ``fromarray`` may expose a read-only buffer; floodfill needs its own image storage.
    image = Image.fromarray(padded, mode="L").copy()
    ImageDraw.floodfill(image, (0, 0), 128, thresh=0)
    return np.asarray(image)[1:-1, 1:-1] == 128


def remove_light_background(frame: Image.Image) -> Image.Image:
    rgb = np.asarray(frame.convert("RGB"), dtype=np.float32)
    background = estimate_background(rgb)

    # Directional distance ignores the brighter Flow watermark while retaining
    # the black costume, red eyes, and the detached black slash trail.
    score = np.maximum(background - rgb, 0).max(axis=2)
    solid_core = score >= 150
    reachable = outside_reachable(~solid_core)

    denominator = np.maximum(background.max(axis=2) - 5, 1)
    alpha = np.clip((score - 5) / denominator, 0, 1)
    # A gap between an arm and the torso can be enclosed by the dark silhouette.
    # Only promote enclosed pixels that are materially darker than the backdrop;
    # otherwise the pale Flow background would remain as an opaque interior patch.
    enclosed_foreground = (~reachable) & (score >= 72)
    alpha[enclosed_foreground] = 1
    alpha[alpha < 0.015] = 0

    # Remove the light matte from partially transparent edge pixels.
    safe_alpha = np.maximum(alpha[..., None], 1e-6)
    unmatte = (rgb - (1 - safe_alpha) * background) / safe_alpha
    output_rgb = np.where((alpha < 1)[..., None], unmatte, rgb)
    output_rgb = np.clip(output_rgb, 0, 255).astype(np.uint8)
    output_rgb[alpha == 0] = 0
    output_alpha = np.rint(alpha * 255).astype(np.uint8)
    return Image.fromarray(np.dstack((output_rgb, output_alpha)), mode="RGBA")


def pack_sheet(frames: list[Image.Image], output: Path) -> None:
    columns = 5
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new("RGBA", (FRAME_WIDTH * columns, FRAME_HEIGHT * rows))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(
            frame,
            ((index % columns) * FRAME_WIDTH, (index // columns) * FRAME_HEIGHT),
        )
    sheet.save(output, optimize=True)


def make_preview(processed: dict[str, list[Image.Image]], output: Path) -> None:
    """Create a dark-background contact sheet for quick alpha-edge QA."""
    selected = {
        "idle": 6,
        "darkPulse": 9,
        "darkBarrage": 10,
        "icham": 10,
        "curse": 15,
        "defeat": 20,
    }
    preview = Image.new("RGB", (FRAME_WIDTH * 3, FRAME_HEIGHT * 2), (18, 20, 28))
    for index, animation in enumerate(ANIMATIONS):
        frame = processed[animation["name"]][selected[animation["name"]]]
        cell = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (18, 20, 28, 255))
        cell.alpha_composite(frame)
        preview.paste(cell.convert("RGB"), ((index % 3) * FRAME_WIDTH, (index // 3) * FRAME_HEIGHT))
    preview.save(output, optimize=True)


def make_motion_preview(processed: dict[str, list[Image.Image]], output: Path) -> None:
    """Animate all six motions together for a quick timing and loop review."""
    preview_frames: list[Image.Image] = []
    preview_fps = 10
    cell_width = FRAME_WIDTH // 2
    cell_height = FRAME_HEIGHT // 2
    for preview_index in range(32):
        preview = Image.new("RGB", (cell_width * 3, cell_height * 2), (18, 20, 28))
        elapsed = preview_index / preview_fps
        for index, animation in enumerate(ANIMATIONS):
            frames = processed[animation["name"]]
            frame_index = int(elapsed * animation["fps"])
            if animation["loop"]:
                frame_index %= len(frames)
            else:
                frame_index = min(frame_index, len(frames) - 1)
            sprite = frames[frame_index].resize(
                (cell_width, cell_height),
                Image.Resampling.LANCZOS,
            )
            cell = Image.new("RGBA", (cell_width, cell_height), (18, 20, 28, 255))
            cell.alpha_composite(sprite)
            preview.paste(
                cell.convert("RGB"),
                ((index % 3) * cell_width, (index // 3) * cell_height),
            )
        preview_frames.append(preview)

    preview_frames[0].save(
        output,
        save_all=True,
        append_images=preview_frames[1:],
        duration=1000 // preview_fps,
        loop=0,
        quality=82,
        method=4,
    )


def build(asset_dir: Path) -> None:
    manifest = {
        "boss": "흑막",
        "format": "rgba-sprite-sheet",
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "columns": 5,
        "animations": {},
    }
    processed: dict[str, list[Image.Image]] = {}

    for animation in ANIMATIONS:
        source_frames = split_source_sheet(asset_dir / animation["source"])
        transparent_frames = [remove_light_background(frame) for frame in source_frames]
        ordered_frames = [transparent_frames[index] for index in animation["frames"]]
        pack_sheet(ordered_frames, asset_dir / animation["output"])
        processed[animation["name"]] = ordered_frames

        manifest["animations"][animation["name"]] = {
            "image": animation["output"],
            "frames": len(ordered_frames),
            "fps": animation["fps"],
            "loop": animation["loop"],
            "events": animation["events"],
        }

    (asset_dir / "animations.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    make_preview(processed, asset_dir / "preview.png")
    make_motion_preview(processed, asset_dir / "motion-preview.webp")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("asset_dir", type=Path)
    args = parser.parse_args()
    build(args.asset_dir.resolve())


if __name__ == "__main__":
    main()
