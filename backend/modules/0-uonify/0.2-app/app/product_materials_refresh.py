"""Authorized, transactional replacement of selected material versions without AI calls.

This is an internal service, not an unrestricted upload route. The caller supplies
downloaded bytes and a fresh metadata callback bound to the authenticated Drive
account. A request is atomic and idempotent; it never saves the product itself.
"""
from copy import deepcopy
from hashlib import sha256, md5
import json
from uuid import UUID
from psycopg.types.json import Jsonb
from .products import find, fail, require_access, present
from .google_account import require_same_connection
from .product_materials_refresh_extract import prepare_replacement, records, segment_map
from .product_materials_facts import consolidate_proposals
from .product_materials_evidence import EvidenceIndex
from .product_materials_values import value_supported
from .product_materials_fields import canonical_attribute, normalized_label


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def verify_metadata(replacement, metadata):
    expected = replacement['metadata']
    if (metadata.get('id') != replacement['sourceId'] or expected.get('id') != replacement['sourceId']
            or not metadata.get('modifiedTime') or metadata.get('trashed')
            or metadata.get('capabilities', {}).get('canDownload') is False):
        fail('materials_source_changed', 'No se puede verificar la versión actual de esta fuente.', 409)
    for key in ('id', 'modifiedTime', 'size', 'mimeType', 'md5Checksum', 'version'):
        if key in expected and str(metadata.get(key)) != str(expected[key]):
            fail('materials_source_changed', 'Una fuente cambió mientras se preparaba esta actualización.', 409)
    content = replacement['content']
    if replacement['mimeType'] != metadata.get('mimeType') or str(len(content)) != str(metadata.get('size')):
        fail('materials_source_changed', 'Los bytes descargados no coinciden con la fuente verificada.', 409)
    if metadata.get('md5Checksum') and md5(content).hexdigest() != metadata['md5Checksum']:
        fail('materials_source_changed', 'La suma del archivo no coincide con la versión de Drive.', 409)


def verify_equivalence(prepared, replacements):
    """An explicit human mapping also needs literal current evidence of every value."""
    by_id = {item['source']['id']: item for item in prepared}
    for item, replacement in zip(prepared, replacements):
        relation = replacement.get('equivalence') or {}
        if item['structured']:
            continue
        master = by_id.get(relation.get('sourceId'))
        if not master or not master['structured'] or not relation.get('statement'):
            item['continuitySafe'] = False
            continue
        master_records = records(segment_map(master['fragments']))
        evidence = EvidenceIndex([item['source']], item['fragments'])
        proved = set()
        for proof in relation.get('proofs', []):
            record = master_records.get(proof.get('fieldId'))
            if not record:
                continue
            entry, error = evidence.verify({'sourceId': item['source']['id'],
                'locator': proof.get('locator'), 'excerpt': proof.get('excerpt')})
            if error:
                continue
            value = str(record.get('value', '')) + ' ' + str(record.get('unit', ''))
            context = evidence.context(entry)
            # A unit on a documented JSON key (dimensions_mm etc.) is an explicit
            # human mapping, never a unit guessed from an unlabelled number.
            unit = proof.get('unit')
            if unit and (unit in entry['text'] or re_unit(unit, entry['locator'])):
                context += '\n.unit: ' + json.dumps(unit)
            matches = (tuple_proof(evidence, entry, proof, record, value.strip()) if 'tupleIndex' in proof
                       else value_supported('', value.strip(), entry['excerpt'], context))
            if matches:
                proved.add(proof['fieldId'])
        expected = set(relation.get('fieldIds', []))
        item['equivalenceVerifiedFields'] = sorted(proved)
        item['continuitySafe'] = bool(item['continuitySafe'] and expected and expected <= proved)
        item['source']['declaredEquivalence']['verifiedFields'] = sorted(proved)


def re_unit(unit, locator):
    import re
    return bool(re.search(r'(?:^|[._\[])' + re.escape(unit) + r'(?:[._\]\[]|$)', locator))


def tuple_proof(index, entry, proof, record, value):
    import re
    position, axes = proof.get('tupleIndex'), proof.get('axes')
    if type(position) is not int or not 0 <= position < 3 or not isinstance(axes, list) or len(axes) != 3:
        return False
    if any(not isinstance(axis, str) or not axis for axis in axes) or len(set(axes)) != 3:
        return False
    order, error = index.verify({'sourceId': entry['sourceId'], 'locator': proof.get('axesLocator'),
                                 'excerpt': proof.get('axesExcerpt')})
    if error or ' '.join(normalized_label(axis) for axis in axes) not in normalized_label(order['excerpt']).replace(' x ', ' '):
        return False
    if not normalized_label(record['label']).endswith(normalized_label(axes[position])):
        return False
    tuples = re.findall(r'(\d+(?:[.,]\d+)?\s*[×x]\s*\d+(?:[.,]\d+)?\s*[×x]\s*\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b', entry['excerpt'])
    if len(tuples) != 1:
        return False
    numbers = re.split(r'\s*[×x]\s*', tuples[0][0])
    return value_supported('', value, numbers[position] + ' ' + tuples[0][1])


def updated_facts(previous, prepared, product, request_id):
    """Retain old decisions exactly; replacement facts are documentary proposals."""
    facts = deepcopy(previous or {'version': 1, 'proposals': []})
    changed = {field for item in prepared for field in item['changedCanonicalFields']}
    prefixes = {item['source']['id']: item['changedRecordPrefixes'] for item in prepared}
    for fact in facts.get('proposals', []):
        citations = fact.get('evidence', [])
        if citations and all(citation.get('sourceId') in prefixes for citation in citations):
            # The confirmation remains the user's historical declaration. Old
            # document evidence is never relabelled as a reading of new bytes.
            fact['historicalEvidence'] = True
        affected = fact.get('canonicalField') in changed or any(
            any(citation.get('locator', '').startswith(prefix + '.')
                for prefix in prefixes.get(citation.get('sourceId'), [])) for citation in citations)
        if affected:
            fact.update(supersededByRefresh=str(request_id), reviewable=False)
    proposals = [p for item in prepared for p in item['candidates']]
    sources = [item['source'] for item in prepared]
    fragments = [f for item in prepared for f in item['fragments']]
    generated = consolidate_proposals(proposals, sources, fragments, product=product)
    for fact in generated['proposals']:
        fact.update(origin='documentary_refresh', refreshRequestId=str(request_id))
    existing = {item['id'] for item in facts.get('proposals', [])}
    facts.setdefault('proposals', []).extend(item for item in generated['proposals'] if item['id'] not in existing)
    facts.setdefault('rejections', []).extend(generated.get('rejections', []))
    facts.update(version=1, stale=False)
    return facts


def product_field_changes(product, prepared, authorization):
    import re
    fields = {field['id']: field for field in product.get('customFields', [])}
    available = {}
    for item in prepared:
        for field_id, record in records(segment_map(item['fragments'])).items():
            if field_id in item['changedFieldIds']:
                if field_id in available and {k: v for k, v in available[field_id].items() if k != 'index'} != {
                        k: v for k, v in record.items() if k != 'index'}:
                    fail('materials_conflict', 'Los documentos corregidos discrepan sobre el mismo dato.', 409)
                available[field_id] = record
    result = []
    seen = set()
    for binding in authorization.get('customFieldBindings', []):
        record, field = available.get(binding.get('fieldId')), fields.get(binding.get('customFieldId'))
        if not record or not field or field['id'] in seen:
            fail('materials_conflict', 'La corrección no corresponde a los campos actuales del producto.', 409)
        # A human-authorized binding still cannot silently replace a different
        # attribute. Units/nominal suffixes are the only label qualifiers removed.
        name = re.sub(r'\s*·\s*diseño nominal\s*$', '', field['name'], flags=re.I)
        name = re.sub(r'\s*\((?:mm|cm|m|kg|g)\)\s*$', '', name, flags=re.I)
        possible = {canonical_attribute('', record['label'])}
        for item in prepared:
            old_record = item.get('previousRecords', {}).get(binding['fieldId'])
            if old_record:
                possible.add(canonical_attribute('', old_record['label']))
        if canonical_attribute('', name) not in possible:
            fail('materials_conflict', 'La corrección apunta a un atributo diferente del documentado.', 409)
        value = str(record['value']).strip() + (' ' + record['unit'].strip() if record.get('unit') else '')
        result.append({'id': field['id'], 'fieldId': binding['fieldId'], 'before': deepcopy(field),
                       'after': {**field, 'name': record['label'], 'value': value, 'isConfirmed': True}})
        seen.add(field['id'])
    return result


def apply_verified_refresh(service, c, user, sku, job_id, revision, request_id,
                           replacements, authorization, *, verify_source, extract=None):
    """Caller transaction owns commit; no provider inference, product save or queueing.

    replacements: sourceId, expectedVersion, expectedSha256, content(bytes), name,
    mimeType, metadata(downloaded version), allowedMetadataPaths, optional equivalence.
    authorization: statement, fieldIds, optional affectedAttributes. Source identity,
    original version, complete parsing and actual current Drive metadata are checked.
    """
    require_access(c, user)
    c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
    product = find(c, user, sku)
    product = c.execute('SELECT * FROM products WHERE id=%s AND user_id=%s FOR UPDATE',
                        (product['id'], user['id'])).fetchone()
    row = service.get_row(c, user, sku, job_id)
    row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
    request_id = UUID(str(request_id))
    if (not isinstance(authorization.get('statement'), str) or not authorization['statement'].strip()
            or not isinstance(authorization.get('fieldIds'), list) or not authorization['fieldIds']
            or any(not isinstance(key, str) or not key for key in authorization['fieldIds'])):
        fail('materials_authorization_required', 'Falta la declaración que autoriza los datos corregidos.', 409)
    if not replacements or len({item['sourceId'] for item in replacements}) != len(replacements):
        fail('materials_conflict', 'Selecciona cada fuente corregida una sola vez.', 409)
    payload = {'revision': revision, 'authorization': authorization, 'replacements': [
        {**{k: v for k, v in item.items() if k != 'content'}, 'contentHash': sha256(item['content']).hexdigest()}
        for item in replacements]}
    payload_hash = digest(payload)
    previous = c.execute('SELECT * FROM product_material_refreshes WHERE user_id=%s AND request_id=%s',
                         (user['id'], request_id)).fetchone()
    if previous:
        if previous['job_id'] != row['id'] or previous['payload_hash'] != payload_hash:
            fail('materials_conflict', 'Esta solicitud ya se utilizó para otra actualización.', 409)
        return previous['summary']
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Revisa su versión antes de actualizar las fuentes.', 409)
    connection = c.execute('SELECT * FROM google_drive_connections WHERE user_id=%s', (user['id'],)).fetchone()
    require_same_connection(user, connection)
    if connection['status'] != 'connected':
        fail('reauthorize', 'Vuelve a conectar Google Drive para comprobar las fuentes.', 409)
    active = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running')",
                       (user['id'],)).fetchone()
    active_reasoning = c.execute("SELECT id FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s AND status IN ('queued','running')",
                                 (user['id'], product['id'])).fetchone()
    if active or active_reasoning or row['status'] not in ('ready', 'paused', 'error'):
        fail('materials_running', 'Espera a que termine o se pause la comprobación en curso.', 409)
    sources = c.execute('SELECT * FROM product_material_sources WHERE job_id=%s ORDER BY source_id FOR UPDATE', (row['id'],)).fetchall()
    by_id = {item['source_id']: item for item in sources}
    all_fragments = c.execute('SELECT * FROM product_material_fragments WHERE job_id=%s ORDER BY id FOR UPDATE', (row['id'],)).fetchall()
    prepared = []
    for replacement in replacements:
        current = by_id.get(replacement['sourceId'])
        if not current or current['version'] != replacement.get('expectedVersion') or current['data'].get('sha256') != replacement.get('expectedSha256'):
            fail('materials_source_changed', 'La fuente conservada no coincide con la versión que quieres sustituir.', 409)
        verify_metadata(replacement, verify_source(user, replacement['sourceId']))
        if sha256(replacement['content']).hexdigest() == current['data'].get('sha256'):
            fail('materials_unchanged', 'El archivo conserva exactamente el contenido ya guardado.', 409)
        fragments = [item for item in all_fragments if item['source_id'] == replacement['sourceId']]
        prepared.append(prepare_replacement(current['data'], fragments, replacement, authorization,
                                            **({'extract': extract} if extract else {})))
    verify_equivalence(prepared, replacements)
    # Close the race between preparation and committing all versions as one change.
    for replacement in replacements:
        verify_metadata(replacement, verify_source(user, replacement['sourceId']))
    result = deepcopy(row['result'])
    result['facts'] = updated_facts(result.get('facts'), prepared, present(product), request_id)
    replacements_by_id = {item['source']['id']: item['source'] for item in prepared}
    result['sources'] = [replacements_by_id.get(source['id'], source) for source in result.get('sources', [])]
    stored = {source['id'] for source in result['sources']}
    result['sources'].extend(s['data'] if s['source_id'] not in replacements_by_id else replacements_by_id[s['source_id']]
                             for s in sources if s['source_id'] not in stored)
    # Existing candidate/decision and call records remain preserved; only new
    # candidates are appended. The source-version snapshots make old citations recoverable.
    result.setdefault('proposals', []).extend(p for item in prepared for p in item['candidates'])
    from .product_reasoning import material_signature
    changed_ids = sorted({key for item in prepared for key in item['changedFieldIds']})
    changed_fields = sorted({key for item in prepared for key in item['changedCanonicalFields']})
    manifest = {'version': 1, 'selectiveSnapshots': True,
        'sourcesBefore': [s['data'] for s in sources if s['source_id'] in replacements_by_id],
        'fragmentsBefore': [{k: f[k] for k in ('id', 'state', 'version', 'source_id')}
                            for f in all_fragments if f['source_id'] in replacements_by_id],
        'productFieldChanges': product_field_changes(present(product), prepared, authorization),
        'sourcesAfter': [item['source'] for item in prepared], 'changes': [
            {k: value for k, value in item.items() if k not in ('fragments', 'candidates', 'source')} |
            {'sourceId': item['source']['id'], 'beforeVersion': by_id[item['source']['id']]['version'],
             'afterVersion': item['source']['version'], 'newFragmentIds': [f['id'] for f in item['fragments']]}
            for item in prepared]}
    manifest['newFragmentHashes'] = {f['id']: digest({k: f[k] for k in (
        'id', 'source_id', 'version', 'state', 'payload', 'result')}) for item in prepared for f in item['fragments']}
    # Datetimes in snapshots are encoded only at the history boundary; source
    # payloads and analysis objects are otherwise kept byte-for-byte equivalent.
    manifest = json.loads(json.dumps(manifest, default=str))
    summary = {'version': 1, 'requestId': str(request_id), 'previousProductRevision': revision,
        'changedSourceIds': sorted(replacements_by_id), 'changedFieldIds': changed_ids,
        'changedCanonicalFields': changed_fields, 'affectedAttributes': authorization.get('affectedAttributes', []),
        'previousMaterialSignature': material_signature({**row['result'], 'id': str(row['id']), 'status': row['status']}),
        'currentMaterialSignature': material_signature({**result, 'id': str(row['id']), 'status': row['status']}),
        'continuitySafe': all(item['continuitySafe'] for item in prepared), 'manifestHash': digest(manifest),
        'semanticStatus': {item['source']['id']: item['source']['semanticStatus'] for item in prepared}}
    result['sourceRefresh'] = summary
    c.execute('''INSERT INTO product_material_refreshes(user_id,request_id,job_id,product_id,revision,
        google_subject,payload_hash,owner_authorization,result_before,manifest,summary)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', (user['id'], request_id, row['id'], product['id'], revision,
        user['google_subject'], payload_hash, Jsonb(authorization), Jsonb(row['result']), Jsonb(manifest), Jsonb(summary)))
    for item in prepared:
        source = item['source']
        c.execute('UPDATE product_material_sources SET version=%s,data=%s,updated_at=now() WHERE job_id=%s AND source_id=%s',
                  (source['version'], Jsonb(source), row['id'], source['id']))
        c.execute("UPDATE product_material_fragments SET state='superseded',updated_at=now() WHERE job_id=%s AND source_id=%s AND state<>'superseded'",
                  (row['id'], source['id']))
        for fragment in item['fragments']:
            c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload,result)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''', (row['id'], fragment['id'], source['id'], source['version'],
                fragment['locator'], fragment['state'], Jsonb(fragment['payload']), Jsonb(fragment['result'])))
    c.execute('UPDATE product_material_jobs SET result=%s,updated_at=now() WHERE id=%s', (Jsonb(result), row['id']))
    return summary
