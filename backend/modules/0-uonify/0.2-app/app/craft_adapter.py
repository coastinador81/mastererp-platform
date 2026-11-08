"""Traductor puro de un job verificado a comandos Craft; nunca los ejecuta."""

from .craft_candidate import accept_candidate_result
from .craft_contracts import (CraftAdapterPlan, CraftCommand, CraftPreflight,
                              ResolvedCraftJob, canonical_sha256,
                              craft_input_expected_sha256, craft_input_path,
                              resolved_job_binding_sha256)
from .creative_edit_recipe import EDIT_RECIPE


TICKS_PER_SECOND = 254_016_000_000

def _seconds(frame: int, frame_rate: dict) -> float:
    return frame * frame_rate["denominator"] / frame_rate["numerator"]


def _film_inputs(job: ResolvedCraftJob) -> tuple[dict, ...]:
    return tuple({"assetId": item.asset_id, "path": craft_input_path(item),
                  "expectedSha256": craft_input_expected_sha256(item),
                  "storageGeneration": item.storage_receipt.generation}
                 for item in job.inputs)


def _film_imports(job: ResolvedCraftJob,
                  inputs: tuple[dict, ...]) -> list[CraftCommand]:
    normal = [row["path"] for asset, row in zip(job.inputs, inputs)
              if asset.kind != "image_sequence"]
    commands = [CraftCommand("media_import", {"paths": normal})] if normal else []
    commands.extend(CraftCommand("media_import", {
        "paths": [row["path"]], "image_sequence": True})
        for asset, row in zip(job.inputs, inputs)
        if asset.kind == "image_sequence")
    return commands



def _adapter(job: ResolvedCraftJob, preflight: CraftPreflight,
             inputs: tuple[dict, ...], commands: tuple[CraftCommand, ...],
             project: str, output: str) -> CraftAdapterPlan:
    payload = {
        "schemaVersion": 1, "jobId": job.job_id,
        "inputManifestSha256": job.input_manifest_sha256,
        "engine": {"name": job.engine.name, "version": job.engine.version},
        "operation": job.operation, "inputs": inputs,
        "jobBindingSha256": preflight.job_binding_sha256,
        "commands": [{"id": item.id, "params": item.params} for item in commands],
        "nativeProjectRelativePath": project, "outputRelativePath": output,
    }
    return CraftAdapterPlan(
        1, job.job_id, job.input_manifest_sha256, job.engine, job.operation,
        preflight.job_binding_sha256, inputs, commands, project, output,
        canonical_sha256(payload),
    )


def _photo_plan(job: ResolvedCraftJob, preflight: CraftPreflight) -> CraftAdapterPlan:
    parsed = EDIT_RECIPE.validate_python(job.plan.snapshot["recipe"])
    asset, source = job.inputs[0], parsed.layers[0]
    input_path = f"/work/inputs/{asset.mount_name}"
    inputs = ({"assetId": asset.asset_id, "path": input_path,
               "expectedSha256": asset.sha256,
               "storageGeneration": asset.storage_receipt.generation},)
    commands = [CraftCommand("doc_open", {"path": input_path}),
                CraftCommand("image.crop", {
                    "x": source.crop.xPixels, "y": source.crop.yPixels,
                    "width": source.crop.widthPixels, "height": source.crop.heightPixels,
                })]
    project, output = "out/photocraft/edited.pcraft", "out/photocraft/edited.png"
    commands.extend((CraftCommand("doc_inspect", {}),
                     CraftCommand("doc_save", {"path": "/work/" + project}),
                     CraftCommand("doc_export", {"path": "/work/" + output})))
    return _adapter(job, preflight, inputs, tuple(commands), project, output)


def _effect_plan(job: ResolvedCraftJob, preflight: CraftPreflight) -> CraftAdapterPlan:
    parsed = EDIT_RECIPE.validate_python(job.plan.snapshot["recipe"])
    by_id = {item.asset_id: item for item in job.inputs}
    inputs = tuple({"assetId": item.asset_id,
                    "path": f"/work/inputs/{item.mount_name}",
                    "expectedSha256": item.sha256,
                    "storageGeneration": item.storage_receipt.generation}
                   for item in job.inputs)
    rate = parsed.canvas.frameRate
    duration = parsed.canvas.durationFrames * rate.denominator / rate.numerator
    title = next(item for item in parsed.layers if item.kind == "text")
    commands = [CraftCommand("comp.new", {
        "name": "UonifyMotion", "width": parsed.canvas.widthPixels,
        "height": parsed.canvas.heightPixels,
        "frameRate": rate.numerator / rate.denominator, "duration": duration,
    })]
    asset_layers = [item for item in parsed.layers if item.kind == "asset"]
    if asset_layers:
        source = by_id[str(asset_layers[0].sourceAssetId)]
        commands.append(CraftCommand("file.import", {
            "paths": [f"/work/inputs/{source.mount_name}"], "addToComp": True,
        }))
    commands.append(CraftCommand("layer.newText", {
        "text": title.exactText, "name": title.name, "size": title.style.sizePixels,
        "position": [title.transform.position.x, title.transform.position.y],
        "fill": title.style.fill[:7],
    }))
    if parsed.keyframes:
        commands.append(CraftCommand("add_keyframe", {
            "layer": title.name, "path": "transform/opacity",
            "keys": [{"time": item.frame * rate.denominator / rate.numerator,
                      "value": item.scalarValue} for item in parsed.keyframes],
            "interpolation": "linear",
        }))
    project, output = "out/effectcraft/motion.ecproj", parsed.output.relativePattern
    render_path = output.replace("_%05d.png", ".png")
    commands.extend((
        CraftCommand("save_project", {"path": "/work/" + project}),
        CraftCommand("renderQueue.add", {
            "comp": "UonifyMotion", "format": "png", "output": "/work/" + render_path,
            "channels": "rgba", "timeSpan": "custom", "start": 0, "end": duration,
        }),
        CraftCommand("renderQueue.render", {"wait": True}),
    ))
    return _adapter(job, preflight, inputs, tuple(commands), project, output)


def _canonical_film_plan(job: ResolvedCraftJob,
                         preflight: CraftPreflight) -> CraftAdapterPlan:
    parsed = EDIT_RECIPE.validate_python(job.plan.snapshot["recipe"])
    rate = parsed.canvas.frameRate
    fps = rate.numerator / rate.denominator
    inputs = _film_inputs(job)
    by_id = {item.asset_id: item for item in job.inputs}
    commands = [CraftCommand("file.newSequence", {
        "name": "UonifyCraft", "width": parsed.canvas.widthPixels,
        "height": parsed.canvas.heightPixels, "fps": fps, "sampleRate": 48000,
        "video": 2, "audio": 2,
    })]
    commands.extend(_film_imports(job, inputs))
    for row in parsed.placements:
        asset = by_id[str(row.assetId)]
        symbolic = f"asset:{asset.asset_id}"
        audio = row.track.startswith("A")
        commands.append(CraftCommand("timeline.place", {
            "item": symbolic, "track": row.track,
            "seconds": _seconds(row.startFrame, rate.model_dump()),
            "duration": round(_seconds(row.durationFrames, rate.model_dump())
                              * TICKS_PER_SECOND),
            "video": not audio, "audio": audio,
        }))
        if row.gainDb is not None:
            commands.append(CraftCommand("clip.audioGain", {
                "clips": [symbolic], "mode": "set", "db": row.gainDb,
            }))
        if row.fadeStartFrame is not None:
            for frame, value in ((row.fadeStartFrame, 0.0), (row.fadeEndFrame, -60.0)):
                commands.append(CraftCommand("mixer.setKeyframe", {
                    "strip": row.track, "lane": "volume",
                    "time": round(_seconds(frame, rate.model_dump()) * TICKS_PER_SECOND),
                    "value": value,
                }))
    project, output = "out/filmcraft/timeline.fcproj", "out/filmcraft/final.mp4"
    commands.extend((CraftCommand("file.saveAs", {"path": "/work/" + project}),
                     CraftCommand("file.exportMedia", {
                         "path": "/work/" + output, "format": "h264",
                         "width": parsed.canvas.widthPixels,
                         "height": parsed.canvas.heightPixels, "fps": fps,
                         "audio": True, "hardwareEncoding": "off", "wait": True,
                     })))
    return _adapter(job, preflight, inputs, tuple(commands), project, output)


def build_craft_adapter_plan(job: ResolvedCraftJob,
                             preflight: CraftPreflight) -> CraftAdapterPlan:
    if (not preflight.ready or preflight.blockers or preflight.job_id != job.job_id
            or preflight.engine != job.engine or preflight.operation != job.operation
            or preflight.job_binding_sha256 != resolved_job_binding_sha256(job)
            or preflight.recipe_sha256
            != canonical_sha256(job.plan.snapshot.get("recipe", {}))):
        raise ValueError("El preflight no autoriza este snapshot Craft.")
    recipe = job.plan.snapshot.get("recipe", {})
    if recipe.get("kind") == "image_edit":
        return _photo_plan(job, preflight)
    if recipe.get("kind") == "motion_graphics":
        return _effect_plan(job, preflight)
    if recipe.get("kind") == "video_assemble":
        return _canonical_film_plan(job, preflight)
    if job.engine.name != "filmcraft" or job.operation != "video_export":
        raise ValueError("No existe traductor Craft para esta operación.")

    recipe = job.plan.snapshot["recipe"]
    frame_rate = recipe["canvas"]["frameRate"]
    fps = frame_rate["numerator"] / frame_rate["denominator"]
    commands = [CraftCommand("file.newSequence", {
        "name": "UonifyCraft", "width": recipe["canvas"]["widthPixels"],
        "height": recipe["canvas"]["heightPixels"], "fps": fps,
        "sampleRate": 48000, "video": 2, "audio": 2,
    })]
    inputs = _film_inputs(job)
    commands.extend(_film_imports(job, inputs))
    assets = {item.asset_id: item for item in job.inputs}
    rows = [*(dict(item, role="shot") for item in recipe.get("shots", [])),
            *(dict(item, role="overlay") for item in recipe.get("overlays", []))]
    for row in rows:
        asset = assets[row["assetId"]]
        commands.append(CraftCommand("timeline.place", {
            "item": f"asset:{asset.asset_id}", "track": row["track"],
            "seconds": _seconds(row["startFrame"], frame_rate),
            "duration": round(_seconds(row["durationFrames"], frame_rate)
                              * TICKS_PER_SECOND),
            "video": True, "audio": asset.kind == "video",
        }))
    for key in ("voice", "music"):
        row = recipe.get(key)
        if not row:
            continue
        asset = assets[row["assetId"]]
        symbolic = f"asset:{asset.asset_id}"
        commands.append(CraftCommand("timeline.place", {
            "item": symbolic, "track": row["track"],
            "seconds": _seconds(row["startFrame"], frame_rate),
            "duration": round(_seconds(row["durationFrames"], frame_rate)
                              * TICKS_PER_SECOND),
            "video": False, "audio": True,
        }))
        if row.get("gainDb"):
            commands.append(CraftCommand("clip.audioGain", {
                "clips": [symbolic], "mode": "set", "db": row["gainDb"],
            }))
        if key == "music" and row.get("fadeStartFrame") is not None:
            for frame, value in ((row["fadeStartFrame"], 0.0),
                                 (row["fadeEndFrame"], -60.0)):
                commands.append(CraftCommand("mixer.setKeyframe", {
                    "strip": row["track"], "lane": "volume",
                    "time": round(_seconds(frame, frame_rate) * TICKS_PER_SECOND),
                    "value": value,
                }))
    project = "out/filmcraft/timeline.fcproj"
    output = "out/filmcraft/final.mp4"
    commands.extend((
        CraftCommand("file.saveAs", {"path": "/work/" + project}),
        CraftCommand("file.exportMedia", {
            "path": "/work/" + output, "format": "h264",
            "width": recipe["canvas"]["widthPixels"],
            "height": recipe["canvas"]["heightPixels"], "fps": fps,
            "audio": True, "hardwareEncoding": "off", "wait": True,
        }),
    ))
    return _adapter(job, preflight, inputs, tuple(commands), project, output)
