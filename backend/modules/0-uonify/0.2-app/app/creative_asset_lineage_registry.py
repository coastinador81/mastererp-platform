"""Relational Craft lineage for immutable creative asset revisions."""

from uuid import UUID


def _project(value: object) -> UUID | None:
    return UUID(str(value)) if value is not None else None


def validate_persisted_craft_sources(c, owner_id: object,
                                     owner_project_id: str | None,
                                     lineage: dict) -> None:
    """Lock exact current inputs in deterministic order before deriving output."""
    if lineage.get('origin') != 'craft':
        return
    sources = lineage.get('sources')
    if not isinstance(sources, list):
        raise ValueError('El linaje Craft no declara fuentes persistidas.')
    locked = {}
    for item in sorted(sources, key=lambda value: (
            value['assetId'], value['revision'])):
        source = c.execute('''SELECT a.uonify_project_id,a.current_revision,
            a.authorization_state,r.snapshot_sha256
            FROM creative_assets a JOIN creative_asset_revisions r
              ON r.user_id=a.user_id AND r.asset_id=a.id
             AND r.revision=a.current_revision
            WHERE a.user_id=%s AND a.id=%s FOR SHARE OF a,r''',
            (owner_id, item['assetId'])).fetchone()
        if (not source or source['authorization_state'] != 'allowed'
                or source['current_revision'] != item['revision']
                or source['snapshot_sha256'] != item['snapshotSha256']
                or source['uonify_project_id'] != _project(owner_project_id)):
            raise ValueError('Una fuente Craft ya no está autorizada en el proyecto.')
        locked[item['assetId']] = source
    if len(locked) != len(sources):
        raise ValueError('El linaje Craft repite una fuente.')


def validate_persisted_asset_lineage(c, owner_id: object, snapshot) -> None:
    """Validate persisted bytes named by a canonical asset snapshot."""
    lineage = snapshot.lineage
    if lineage['origin'] == 'craft':
        validate_persisted_craft_sources(
            c, owner_id, snapshot.owner_project_id, lineage)
        return
    if lineage['origin'] != 'derived':
        return
    source_id = lineage['sourceAssetId']
    if source_id == snapshot.asset_id:
        raise ValueError('El asset derivado no puede declararse como su propia fuente.')
    source = c.execute('''SELECT r.revision,a.uonify_project_id
        FROM creative_asset_revisions r JOIN creative_assets a
          ON a.user_id=r.user_id AND a.id=r.asset_id
        WHERE r.user_id=%s AND r.asset_id=%s AND r.sha256=%s
          AND a.authorization_state='allowed'
          AND a.uonify_project_id IS NOT DISTINCT FROM %s
        ORDER BY r.revision DESC LIMIT 1 FOR SHARE OF a,r''',
        (owner_id, source_id, lineage['sourceSha256'],
         snapshot.owner_project_id)).fetchone()
    if not source:
        raise ValueError('La fuente persistida del asset derivado no coincide.')


def persist_asset_lineage_sources(c, owner_id: object, snapshot) -> None:
    """Materialize ordered Craft edges after the output revision exists."""
    if snapshot.lineage['origin'] != 'craft':
        return
    for ordinal, item in enumerate(snapshot.lineage['sources']):
        c.execute('''INSERT INTO creative_asset_lineage_sources
            (user_id,output_asset_id,output_revision,ordinal,
             source_asset_id,source_revision,source_snapshot_sha256)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (owner_id, snapshot.asset_id, snapshot.revision, ordinal,
             item['assetId'], item['revision'], item['snapshotSha256']))
