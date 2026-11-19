import json
from decimal import Decimal, InvalidOperation
from urllib.error import URLError
from urllib.request import Request, urlopen

URL = "https://bcv.today/api/v1/rate.json"

def current_rate(timeout=3, attempts=1):
    for _ in range(max(1, attempts)):
        try:
            with urlopen(Request(URL, headers={"Accept":"application/json","User-Agent":"mastererp-ecommerce/1.0"}), timeout=timeout) as response:
                payload = json.loads(response.read())
            rate = Decimal(str(payload.get("USD")))
            effective = str(payload.get("effective_date") or payload.get("date") or "")
            if rate > 0 and effective:
                return {"rate":str(rate), "source":"bcv.today", "effectiveDate":effective}
        except (URLError, TimeoutError, OSError, ValueError, InvalidOperation, json.JSONDecodeError):
            continue
    return None
