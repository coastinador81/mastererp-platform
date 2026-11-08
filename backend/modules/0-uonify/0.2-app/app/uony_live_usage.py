"""Bounded token-usage parsing for Live receipts; never reads conversation data."""


def usage_counts(value):
    if not isinstance(value, dict):
        raise ValueError('invalid Live usage')
    counts = {}
    def count(value):
        if type(value) is int:
            return value if 0 <= value <= 100_000_000 else None
        if isinstance(value, str) and value.isdigit() and len(value) <= 9:
            parsed = int(value)
            return parsed if parsed <= 100_000_000 else None
        return None
    for key in ('promptTokenCount', 'candidatesTokenCount', 'totalTokenCount',
                'cachedContentTokenCount', 'toolUsePromptTokenCount'):
        amount = count(value.get(key))
        if amount is not None:
            counts[key] = amount
    for key in ('promptTokensDetails', 'candidatesTokensDetails'):
        details = value.get(key)
        if isinstance(details, list):
            clean = []
            for detail in details[:8]:
                if not isinstance(detail, dict):
                    continue
                modality, amount = detail.get('modality'), count(detail.get('tokenCount'))
                if modality in ('AUDIO', 'TEXT', 'VIDEO', 'IMAGE') and amount is not None:
                    clean.append({'modality': modality, 'tokenCount': amount})
            if clean:
                counts[key] = clean
    return counts
