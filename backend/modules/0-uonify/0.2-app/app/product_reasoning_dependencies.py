"""PTD dependencies at their instance scope; predicate operands are not dependencies."""
from .incident_schema_validation import validator_for

_MISSING = object()


def dependency_closure(schema, changed, before=None, after=None):
    roots = set(schema.get('properties', {}))
    rules = []
    dynamic = isinstance(before, dict) and isinstance(after, dict)
    try:
        validator = validator_for(schema)
    except Exception:
        validator = None

    def resolve(ref):
        if ref == '#': return schema
        if not isinstance(ref, str) or not ref.startswith('#/'): return None
        node = schema
        for part in ref[2:].split('/'):
            if not isinstance(node, dict): return None
            node = node.get(part.replace('~1', '/').replace('~0', '~'))
        return node if isinstance(node, (dict, bool)) else None

    def scope(path):
        return {path[0]} & roots if path else roots

    def mentions(node, path=(), refs=frozenset()):
        if node is True: return set()
        if node is False: return scope(path)
        if not isinstance(node, dict): return scope(path)
        if path: return scope(path)
        found = (set(node.get('properties', {})) | set(node.get('required', []))) & roots
        if '$ref' in node:
            ref = node['$ref']; target = resolve(ref)
            if ref in refs or target is None: return roots
            found |= mentions(target, path, refs | {ref})
        for key in ('allOf', 'anyOf', 'oneOf'):
            for child in node.get(key, []): found |= mentions(child, path, refs)
        for key in ('if', 'then', 'else', 'not'):
            if key in node: found |= mentions(node[key], path, refs)
        for key in ('dependentRequired', 'dependentSchemas', 'dependencies'):
            for name, child in node.get(key, {}).items():
                found |= {name} & roots
                found |= (set(child) & roots) if isinstance(child, list) else mentions(child, path, refs)
        # These root-level constraints can involve an attribute not explicitly named.
        if any(key in node for key in ('patternProperties', 'additionalProperties', 'propertyNames',
                                      'minProperties', 'maxProperties', 'unevaluatedProperties')):
            found |= roots
        return found

    def valid(node, instance):
        if not dynamic or validator is None or instance is _MISSING: return None
        try:
            # evolve preserves the original root resolver, including #/properties refs.
            return validator.evolve(schema=node).is_valid(instance)
        except Exception:
            return None

    def add(inputs, outputs, stable=False):
        if inputs and outputs: rules.append((inputs, outputs, stable))

    def uncertain(path):
        add(roots, scope(path))

    def child(instance, key):
        return instance.get(key, _MISSING) if isinstance(instance, dict) else _MISSING

    def walk(node, path=(), old=_MISSING, new=_MISSING, refs=frozenset(), depth=0):
        if node is True: return
        if depth > 48 or not isinstance(node, (dict, bool)):
            uncertain(path); return
        if node is False:
            uncertain(path); return
        if '$ref' in node:
            ref = node['$ref']; target = resolve(ref)
            if ref in refs or target is None: uncertain(path)
            else: walk(target, path, old, new, refs | {ref}, depth + 1)
        if 'if' in node:
            left, right = valid(node['if'], old), valid(node['if'], new)
            stable = left is not None and left == right
            outputs = mentions(node.get('then', {}), path) | mentions(node.get('else', {}), path)
            inputs = mentions(node['if'], path)
            if left is None or right is None:
                inputs = inputs or scope(path)
            add(inputs, outputs, stable)
            # Do not walk the predicate: its anyOf/not operands are tests, not
            # constraints that make their inputs depend on each other.
            branches = ['then' if left else 'else'] if stable else ['then', 'else']
            for key in branches:
                if key in node: walk(node[key], path, old, new, refs, depth + 1)
        for branch in node.get('allOf', []): walk(branch, path, old, new, refs, depth + 1)
        for keyword in ('anyOf', 'oneOf'):
            branches = node.get(keyword, [])
            if not branches: continue
            left = [valid(branch, old) for branch in branches]
            right = [valid(branch, new) for branch in branches]
            stable = None not in left + right and left == right and any(left)
            group = set().union(*(mentions(branch, path) for branch in branches))
            add(group, group, stable)
            for i, branch in enumerate(branches):
                if not stable or left[i]: walk(branch, path, old, new, refs, depth + 1)
        if 'not' in node:
            left, right = valid(node['not'], old), valid(node['not'], new)
            group = mentions(node['not'], path)
            add(group, group, left is not None and left == right)
        for keyword in ('dependentRequired', 'dependentSchemas', 'dependencies'):
            for key, branch in node.get(keyword, {}).items():
                left, right = isinstance(old, dict) and key in old, isinstance(new, dict) and key in new
                inputs = scope(path) if path else {key} & roots
                outputs = (scope(path) if path else set(branch) & roots) if isinstance(branch, list) else mentions(branch, path)
                add(inputs, outputs, dynamic and left == right)
                if not isinstance(branch, list) and (not dynamic or left or right):
                    walk(branch, path, old, new, refs, depth + 1)
        for key, branch in node.get('properties', {}).items():
            left, right = child(old, key), child(new, key)
            if dynamic and left is _MISSING and right is _MISSING: continue
            walk(branch, path + (key,), left, right, refs, depth + 1)
        for keyword in ('items', 'contains'):
            if keyword not in node: continue
            branch = node[keyword]
            if not dynamic:
                for item in branch if isinstance(branch, list) else [branch]:
                    walk(item, path + (0,), refs=refs, depth=depth + 1)
                continue
            if old is not _MISSING and not isinstance(old, list) or new is not _MISSING and not isinstance(new, list):
                uncertain(path); continue
            left, right = old if isinstance(old, list) else [], new if isinstance(new, list) else []
            if max(len(left), len(right)) > 100:
                uncertain(path); continue
            for i in range(max(len(left), len(right))):
                item = branch[i] if isinstance(branch, list) and i < len(branch) else node.get('additionalItems', True) if isinstance(branch, list) else branch
                walk(item, path + (i,), left[i] if i < len(left) else _MISSING,
                     right[i] if i < len(right) else _MISSING, refs, depth + 1)
        # Pattern/evaluated-property scopes cannot safely be mapped to one path.
        if any(key in node for key in ('patternProperties', 'unevaluatedProperties', 'unevaluatedItems', '$dynamicRef', '$recursiveRef')):
            uncertain(path)
        if isinstance(node.get('additionalProperties'), dict): uncertain(path)

    try:
        walk(schema, old=before if dynamic else _MISSING, new=after if dynamic else _MISSING)
    except (TypeError, ValueError, RecursionError):
        # Malformed or unsupported traversal must never certify old answers as reusable.
        return set(changed) | roots
    affected = set(changed)
    while True:
        more = set(affected)
        for inputs, outputs, stable in rules:
            # An unchanged predicate is safe only for direct, known answers.
            # An indirectly affected input still invalidates its downstream facts.
            if inputs & affected and (not stable or inputs & (affected - set(changed))): more |= outputs
        if more == affected: return affected
        affected = more
