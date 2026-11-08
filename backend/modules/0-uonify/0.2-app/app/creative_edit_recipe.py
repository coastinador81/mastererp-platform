"""Receta canónica de finishing; liga dirección creativa con edición determinista.

No ejecuta Craft, no resuelve assets y no autoriza gasto. Los adaptadores solo
pueden traducir una receta ya ligada a snapshots y recibos del servicio root.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import Field, TypeAdapter, model_validator

from .creative_execution_draft import CreativeExecutionDraft
from .creative_image_direction import DirectedImagePlan
from .creative_video_direction import DirectedVideoBatch
from .onboarding import StrictBody


HASH = r'^[0-9a-f]{64}$'
JsonUUID = Annotated[UUID, Field(strict=False)]


def canonical_sha256(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':'), allow_nan=False)
    return sha256(payload.encode()).hexdigest()


class RecipeSources(StrictBody):
    sourcePlanSha256: str = Field(pattern=HASH)
    executionSnapshotSha256: str = Field(pattern=HASH)
    strategySha256: str = Field(pattern=HASH)
    directionSha256: str = Field(pattern=HASH)
    skillVersion: str = Field(min_length=3, max_length=160)
    skillSourceSha256: str = Field(pattern=HASH)


class ReceiptBinding(StrictBody):
    bucket: str = Field(min_length=3, max_length=222)
    name: str = Field(min_length=10, max_length=1024)
    generation: int = Field(ge=1)
    mimeType: str = Field(min_length=3, max_length=100)
    byteSize: int = Field(ge=1, le=2 * 1024**3)
    sha256: str = Field(pattern=HASH)


class RecipeAsset(StrictBody):
    assetId: JsonUUID
    revision: int = Field(ge=1)
    kind: Literal['image', 'video', 'audio', 'image_sequence']
    widthPixels: int | None = Field(default=None, ge=1, le=16384)
    heightPixels: int | None = Field(default=None, ge=1, le=16384)
    durationSeconds: float | None = Field(default=None, gt=0, le=3600)
    frameRate: FrameRate | None = None
    sampleRateHz: int | None = Field(default=None, ge=8000, le=192000)
    channels: int | None = Field(default=None, ge=1, le=8)
    encoding: str | None = Field(default=None, min_length=2, max_length=40)
    frameCount: int | None = Field(default=None, ge=1, le=216000)
    manifestSha256: str | None = Field(default=None, pattern=HASH)
    bundlePlanSha256: str | None = Field(default=None, pattern=HASH)
    format: Literal['uonify.effect-frame-bundle.v1'] | None = None
    receipt: ReceiptBinding

    @model_validator(mode='after')
    def media(self):
        visual = self.kind in ('image', 'video', 'image_sequence')
        if visual != (self.widthPixels is not None and self.heightPixels is not None):
            raise ValueError('Un asset visual necesita geometría; audio no la admite.')
        sequence = (self.frameCount, self.manifestSha256,
                    self.bundlePlanSha256, self.format)
        if self.kind == 'image' and any(value is not None for value in (
                self.durationSeconds, self.frameRate, self.sampleRateHz,
                self.channels, self.encoding, *sequence)):
            raise ValueError('Una imagen no admite metadatos temporales o de audio.')
        if self.kind == 'video' and (self.durationSeconds is None
                                     or self.frameRate is None
                                     or any(value is not None for value in (
                                         self.sampleRateHz, self.channels,
                                         self.encoding, *sequence))):
            raise ValueError('Un vídeo necesita duración y cadencia.')
        if self.kind == 'image_sequence' and (
                self.durationSeconds is None or self.frameRate is None
                or any(value is None for value in sequence)
                or any(value is not None for value in (
                    self.sampleRateHz, self.channels, self.encoding))):
            raise ValueError('Una secuencia necesita duración, cadencia y manifest.')
        if self.kind == 'audio' and (self.durationSeconds is None
                                     or self.sampleRateHz is None
                                     or self.channels is None
                                     or self.encoding is None
                                     or self.frameRate is not None
                                     or any(value is not None for value in sequence)):
            raise ValueError('Un audio necesita duración, sample rate, canales y encoding.')
        prefix = {'image': 'image/', 'video': 'video/', 'audio': 'audio/',
                  'image_sequence': 'application/zip'}[self.kind]
        if (self.kind == 'image_sequence' and self.receipt.mimeType != prefix
                or self.kind != 'image_sequence'
                and not self.receipt.mimeType.startswith(prefix)):
            raise ValueError('El MIME no corresponde al tipo de asset.')
        return self


class EditTarget(StrictBody):
    mode: Literal['create', 'update']
    targetId: JsonUUID | None = None
    expectedRevision: int | None = Field(default=None, ge=1)

    @model_validator(mode='after')
    def coherent(self):
        has_target = self.targetId is not None and self.expectedRevision is not None
        if (self.mode == 'update') != has_target:
            raise ValueError('Update necesita targetId y expectedRevision; create no los admite.')
        return self


class FrameRate(StrictBody):
    numerator: int = Field(ge=1, le=240000)
    denominator: int = Field(ge=1, le=1001)


class Canvas(StrictBody):
    widthPixels: int = Field(ge=16, le=16384)
    heightPixels: int = Field(ge=16, le=16384)
    colorSpace: Literal['srgb'] = 'srgb'
    transparent: bool = False
    frameRate: FrameRate | None = None
    durationFrames: int | None = Field(default=None, ge=1, le=216000)

    @model_validator(mode='after')
    def timeline(self):
        if (self.frameRate is None) != (self.durationFrames is None):
            raise ValueError('Cadencia y duración deben aparecer juntas.')
        return self


class Point(StrictBody):
    x: float = Field(ge=-32768, le=32768)
    y: float = Field(ge=-32768, le=32768)


class CropRect(StrictBody):
    xPixels: int = Field(ge=0)
    yPixels: int = Field(ge=0)
    widthPixels: int = Field(ge=1, le=16384)
    heightPixels: int = Field(ge=1, le=16384)
    sourceWidthPixels: int = Field(ge=1, le=16384)
    sourceHeightPixels: int = Field(ge=1, le=16384)

    @model_validator(mode='after')
    def inside_source(self):
        if (self.xPixels + self.widthPixels > self.sourceWidthPixels
                or self.yPixels + self.heightPixels > self.sourceHeightPixels):
            raise ValueError('El crop queda fuera del asset fuente.')
        return self


class VisualTransform(StrictBody):
    anchor: Point
    position: Point
    scalePercent: Point = Point(x=100, y=100)
    rotationDegrees: float = Field(default=0, ge=-3600, le=3600)
    opacityPercent: float = Field(default=100, ge=0, le=100)


class TextStyle(StrictBody):
    fontFamily: str = Field(min_length=1, max_length=120)
    fontFallback: str = Field(min_length=1, max_length=120)
    weight: int = Field(ge=100, le=900, multiple_of=100)
    sizePixels: float = Field(gt=0, le=1000)
    lineHeight: float = Field(gt=0.5, le=5)
    tracking: float = Field(ge=-20, le=100)
    alignment: Literal['left', 'center', 'right']
    fill: str = Field(pattern=r'^#[0-9A-Fa-f]{8}$')
    stroke: str | None = Field(default=None, pattern=r'^#[0-9A-Fa-f]{8}$')
    box: CropRect


class ImageSourceLayer(StrictBody):
    kind: Literal['source']
    layerId: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,63}$')
    sourceAssetId: JsonUUID
    zIndex: int = Field(ge=0, le=1000)
    crop: CropRect
    transform: VisualTransform
    blendMode: Literal['normal'] = 'normal'


class ImageTextLayer(StrictBody):
    kind: Literal['text']
    layerId: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,63}$')
    role: Literal['headline', 'supporting', 'price', 'terms', 'cta']
    exactText: str = Field(min_length=1, max_length=240)
    destination: str | None = Field(default=None, max_length=500)
    zIndex: int = Field(ge=0, le=1000)
    style: TextStyle
    transform: VisualTransform

    @model_validator(mode='after')
    def destination_only_for_cta(self):
        if (self.role == 'cta') != (self.destination is not None):
            raise ValueError('Solo la CTA necesita destino.')
        return self


ImageLayer = Annotated[Union[ImageSourceLayer, ImageTextLayer],
                       Field(discriminator='kind')]


class ImageEditRecipe(StrictBody):
    schemaVersion: Literal[1]
    kind: Literal['image_edit']
    adapterOperation: Literal['image_edit']
    sources: RecipeSources
    target: EditTarget
    assets: list[RecipeAsset] = Field(min_length=1, max_length=32)
    canvas: Canvas
    layers: list[ImageLayer] = Field(min_length=1, max_length=64)
    outputMimeType: Literal['image/png']

    @model_validator(mode='after')
    def coherent(self):
        if self.canvas.frameRate is not None:
            raise ValueError('La receta de imagen no admite timeline.')
        asset_ids = [item.assetId for item in self.assets]
        layer_ids = [item.layerId for item in self.layers]
        z_indexes = [item.zIndex for item in self.layers]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError('Los assets no pueden repetirse.')
        if len(layer_ids) != len(set(layer_ids)) or len(z_indexes) != len(set(z_indexes)):
            raise ValueError('layerId y zIndex deben ser únicos.')
        known = {item.assetId: item for item in self.assets}
        for item in self.layers:
            if isinstance(item, ImageSourceLayer):
                asset = known.get(item.sourceAssetId)
                if asset is None:
                    raise ValueError('Una capa referencia un asset no resuelto.')
                if (item.crop.sourceWidthPixels != asset.widthPixels
                        or item.crop.sourceHeightPixels != asset.heightPixels):
                    raise ValueError('El crop no coincide con la geometría del asset.')
            elif (item.style.box.sourceWidthPixels != self.canvas.widthPixels
                  or item.style.box.sourceHeightPixels != self.canvas.heightPixels):
                raise ValueError('La caja de texto no corresponde al canvas.')
        return self


class MotionLayer(StrictBody):
    kind: Literal['asset', 'text', 'shape']
    layerId: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,63}$')
    name: str = Field(min_length=1, max_length=120)
    zIndex: int = Field(ge=0, le=1000)
    inFrame: int = Field(ge=0)
    outFrame: int = Field(ge=1)
    sourceAssetId: JsonUUID | None = None
    exactText: str | None = Field(default=None, max_length=240)
    style: TextStyle | None = None
    transform: VisualTransform

    @model_validator(mode='after')
    def typed(self):
        if self.outFrame <= self.inFrame:
            raise ValueError('El intervalo de capa no es válido.')
        if self.kind == 'asset' and self.sourceAssetId is None:
            raise ValueError('La capa asset necesita sourceAssetId.')
        if self.kind == 'text' and (not self.exactText or self.style is None):
            raise ValueError('La capa de texto necesita contenido y estilo.')
        if self.kind != 'asset' and self.sourceAssetId is not None:
            raise ValueError('Solo una capa asset referencia un asset.')
        if self.kind != 'text' and (self.exactText is not None or self.style is not None):
            raise ValueError('Solo una capa text contiene texto y estilo.')
        return self


class VisualKeyframe(StrictBody):
    layerId: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,63}$')
    property: Literal['position', 'scalePercent', 'rotationDegrees', 'opacityPercent']
    frame: int = Field(ge=0)
    scalarValue: float | None = None
    pointValue: Point | None = None
    interpolation: Literal['linear', 'bezier', 'hold', 'ease_in', 'ease_out', 'ease_in_out']

    @model_validator(mode='after')
    def typed(self):
        needs_point = self.property in ('position', 'scalePercent')
        if needs_point != (self.pointValue is not None) or needs_point == (self.scalarValue is not None):
            raise ValueError('El valor del keyframe no corresponde a su propiedad.')
        if self.property == 'opacityPercent' and not 0 <= self.scalarValue <= 100:
            raise ValueError('La opacidad debe estar entre 0 y 100.')
        return self


class MotionGraphicsRecipe(StrictBody):
    schemaVersion: Literal[1]
    kind: Literal['motion_graphics']
    adapterOperation: Literal['motion_graphics']
    sources: RecipeSources
    target: EditTarget
    assets: list[RecipeAsset] = Field(default_factory=list, max_length=32)
    canvas: Canvas
    layers: list[MotionLayer] = Field(min_length=1, max_length=128)
    keyframes: list[VisualKeyframe] = Field(default_factory=list, max_length=1000)
    output: 'FrameSequenceOutput'

    @model_validator(mode='after')
    def coherent(self):
        if self.canvas.frameRate is None or self.canvas.transparent is not True:
            raise ValueError('Motion graphics exige timeline y canvas transparente.')
        asset_ids = [item.assetId for item in self.assets]
        layer_ids = [item.layerId for item in self.layers]
        if len(asset_ids) != len(set(asset_ids)) or len(layer_ids) != len(set(layer_ids)):
            raise ValueError('Assets y capas deben ser únicos.')
        known_assets, known_layers = set(asset_ids), set(layer_ids)
        if any(item.sourceAssetId not in known_assets for item in self.layers
               if item.sourceAssetId is not None):
            raise ValueError('Una capa referencia un asset no resuelto.')
        if any(item.outFrame > self.canvas.durationFrames for item in self.layers):
            raise ValueError('Una capa queda fuera de la composición.')
        if self.output.frameCount != self.canvas.durationFrames:
            raise ValueError('El manifest de cuadros no cubre la composición.')
        if any(item.kind == 'text' and (
                item.style.box.sourceWidthPixels != self.canvas.widthPixels
                or item.style.box.sourceHeightPixels != self.canvas.heightPixels)
               for item in self.layers):
            raise ValueError('La caja de texto no corresponde al canvas.')
        if any(item.layerId not in known_layers or item.frame >= self.canvas.durationFrames
               for item in self.keyframes):
            raise ValueError('Un keyframe queda fuera de la composición o capa.')
        keys = [(item.layerId, item.property, item.frame) for item in self.keyframes]
        if len(keys) != len(set(keys)) or keys != sorted(keys):
            raise ValueError('Los keyframes deben ser únicos y estar ordenados.')
        return self


class FrameSequenceOutput(StrictBody):
    mimeType: Literal['image/png']
    relativePattern: str = Field(pattern=r'^out/effectcraft/[a-z0-9_-]+_%05d\.png$')
    frameCount: int = Field(ge=1, le=216000)
    rgba: Literal[True]


class VideoPlacement(StrictBody):
    assetId: JsonUUID
    track: Literal['V1', 'V2', 'A1', 'A2']
    startFrame: int = Field(ge=0)
    durationFrames: int = Field(ge=1)
    gainDb: float | None = Field(default=None, ge=-60, le=24)
    fadeStartFrame: int | None = Field(default=None, ge=0)
    fadeEndFrame: int | None = Field(default=None, ge=1)

    @model_validator(mode='after')
    def audio_only(self):
        audio = self.track.startswith('A')
        if not audio and any(value is not None for value in (
                self.gainDb, self.fadeStartFrame, self.fadeEndFrame)):
            raise ValueError('Ganancia y fade solo corresponden a pistas de audio.')
        if (self.fadeStartFrame is None) != (self.fadeEndFrame is None):
            raise ValueError('El fade necesita inicio y fin.')
        if self.fadeStartFrame is not None and self.fadeEndFrame <= self.fadeStartFrame:
            raise ValueError('El intervalo de fade no es válido.')
        return self


class VideoAssembleRecipe(StrictBody):
    schemaVersion: Literal[1]
    kind: Literal['video_assemble']
    adapterOperation: Literal['video_export']
    sources: RecipeSources
    target: EditTarget
    assets: list[RecipeAsset] = Field(min_length=1, max_length=64)
    canvas: Canvas
    placements: list[VideoPlacement] = Field(min_length=1, max_length=256)
    outputMimeType: Literal['video/mp4']

    @model_validator(mode='after')
    def coherent(self):
        if self.canvas.frameRate is None:
            raise ValueError('El montaje de vídeo necesita timeline.')
        asset_ids = [item.assetId for item in self.assets]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError('Los assets no pueden repetirse.')
        assets = {item.assetId: item for item in self.assets}
        for item in self.placements:
            asset = assets.get(item.assetId)
            if (asset is None
                    or item.startFrame + item.durationFrames > self.canvas.durationFrames):
                raise ValueError('Una colocación queda fuera del master o asset set.')
            if (item.track.startswith('V')
                    and asset.kind not in ('image', 'video', 'image_sequence')
                    or item.track.startswith('A') and asset.kind != 'audio'):
                raise ValueError('El tipo de asset no corresponde a la pista.')
        return self


EditRecipe = Annotated[Union[ImageEditRecipe, MotionGraphicsRecipe,
                             VideoAssembleRecipe], Field(discriminator='kind')]
EDIT_RECIPE = TypeAdapter(EditRecipe)


@dataclass(frozen=True)
class BoundEditRecipe:
    recipe: ImageEditRecipe | MotionGraphicsRecipe | VideoAssembleRecipe
    recipe_sha256: str
    ready_for_adapter: bool = True
    execution_authorized: bool = False


def _sources(recipe, source_plan_sha, draft, strategy_sha, direction_sha):
    expected = {
        'sourcePlanSha256': source_plan_sha,
        'executionSnapshotSha256': draft.snapshot_sha256,
        'strategySha256': strategy_sha,
        'directionSha256': direction_sha,
        'skillVersion': draft.skill_version,
        'skillSourceSha256': draft.skill_source_sha256,
    }
    if recipe.sources.model_dump(mode='json') != expected:
        raise ValueError('La receta no corresponde a sus snapshots creativos.')


def bind_edit_recipe(source_plan_sha256: str, draft: CreativeExecutionDraft,
                     direction: DirectedImagePlan | DirectedVideoBatch,
                     value: dict) -> BoundEditRecipe:
    """Liga una receta explícita; nunca convierte intención libre en geometría."""
    if (not isinstance(source_plan_sha256, str)
            or len(source_plan_sha256) != 64
            or any(char not in '0123456789abcdef' for char in source_plan_sha256)
            or not isinstance(draft, CreativeExecutionDraft)):
        raise ValueError('Plan o draft de ejecución no válidos.')
    recipe = EDIT_RECIPE.validate_python(value)
    if isinstance(direction, DirectedImagePlan):
        if not isinstance(recipe, ImageEditRecipe) or draft.medium != 'imagen':
            raise ValueError('La receta no corresponde a la dirección de imagen.')
        _sources(recipe, source_plan_sha256, draft, direction.strategy_sha256,
                 direction.direction_sha256)
        expected = [(item.role, item.exactText, item.destination)
                    for item in direction.direction.copyManifest]
        actual = [(item.role, item.exactText, item.destination)
                  for item in recipe.layers if isinstance(item, ImageTextLayer)]
        if actual != expected:
            raise ValueError('El copy de finishing cambió desde la dirección aprobada.')
    elif isinstance(direction, DirectedVideoBatch):
        if isinstance(recipe, ImageEditRecipe) or draft.medium != 'vídeo':
            raise ValueError('La receta no corresponde a la dirección de vídeo.')
        direction_sha = canonical_sha256({
            'directions': [item.model_dump(mode='json')
                           for item in direction.directions],
            'batchSha256': direction.batch.batch_sha256,
        })
        _sources(recipe, source_plan_sha256, draft, direction.strategy_sha256,
                 direction_sha)
        if isinstance(recipe, MotionGraphicsRecipe):
            expected = [text for shot in direction.directions
                        for text in shot.overlayText]
            actual = [item.exactText for item in recipe.layers
                      if item.kind == 'text']
            if actual != expected:
                raise ValueError('Los overlays cambiaron desde la dirección de vídeo.')
        rate = recipe.canvas.frameRate
        seconds = recipe.canvas.durationFrames * rate.denominator / rate.numerator
        frame_seconds = rate.denominator / rate.numerator
        if abs(seconds - direction.batch.requested_seconds) > frame_seconds:
            raise ValueError('La duración del master cambió desde el plan dirigido.')
    else:
        raise ValueError('Dirección creativa no admitida.')
    payload = recipe.model_dump(mode='json')
    return BoundEditRecipe(recipe, canonical_sha256(payload))
