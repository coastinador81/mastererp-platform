"""Estudio §F: máximo en € para PRESENTAR «como máximo ≈ X €» (veredicto 20261022 §F, APROBADO).

El ledger NO cambia: el máximo EXACTO en USD (creative_generation `maxTotalUsd`) es la base técnica y
lo que el dueño AUTORIZA con su OK. El cliente paga a Google; el Estudio va en la suscripción
(40 %/prepago RETIRADOS). El € es SOLO una capa de PRESENTACIÓN: SIEMPRE redondeado hacia arriba y
NUNCA por debajo del coste real. No llama a ningún proveedor, no persiste nada y no decide textos: el
texto que ve el cliente es owner-UX (espera maquetas del dueño).

DOS FUENTES (interfaz/Consultor 22-10):
- PRIMARIA — precio en EUR por SKU que publica Google (Cloud Billing Catalog API, con una cuenta de
  facturación en EUR Google cobra en EUR con su propio precio por SKU). Se pasa su SUMA en
  `eur_sku_total`: es EUR REAL, así que solo se le aplica el techo al paso (sin margen de cambio).
- RESPALDO — si falta el precio en EUR, se convierte el máximo EXACTO en USD con el cambio del BCE
  + margen + techo (`eur_ceiling_from_usd`), etiquetado «aprox./como máximo».
La Cloud Billing Catalog API está HOY deshabilitada en el proyecto QA (Consultor, 403 SERVICE_DISABLED);
habilitar el Cloud Billing API es decisión del dueño. Hasta entonces, la vía viva es el RESPALDO; el
mecanismo ya acepta la fuente primaria para cuando esté disponible. El MARGEN, el PASO y el TEXTO los
decide el dueño con la maqueta de la tarjeta del gasto; la DIVISA de la cuenta del cliente, ver abajo.
Invariante en ambas vías: el € devuelto es >= el coste real (el techo nunca baja).
"""
from decimal import ROUND_CEILING, Decimal

# PROPUESTA (decisión del dueño). El mecanismo es fijo; estos valores los confirma/ajusta el dueño.
EUR_PRIMARY_SOURCE = 'cloud_billing_catalog_eur_per_sku'   # precio EUR por SKU de Google (principal)
EUR_FX_SOURCE = 'ecb_daily_reference'      # respaldo: referencia diaria del BCE
EUR_MARGIN_PROPOSED = Decimal('0.05')      # respaldo: +5 % sobre el cambio
EUR_ROUNDING_STEP = Decimal('0.10')        # redondeo hacia arriba a 0,10 €
# Divisa por defecto si no se puede leer la de la cuenta de facturación del cliente (ver §F proposal):
# EUR = mercado principal del dueño; con EUR, la fuente primaria (precio EUR por SKU) es la correcta.
EUR_DEFAULT_ACCOUNT_CURRENCY = 'EUR'


def _ceil_to_step(value: Decimal, step: Decimal) -> Decimal:
    """Techo de `value` al múltiplo de `step` (>= value siempre)."""
    steps = (value / step).to_integral_value(rounding=ROUND_CEILING)
    return (steps * step).quantize(step)


def eur_ceiling_from_usd(usd_max, fx_usd_to_eur, *, margin=EUR_MARGIN_PROPOSED,
                         step=EUR_ROUNDING_STEP):
    """RESPALDO: techo en € de un máximo EXACTO en USD. SIEMPRE >= usd_max * fx_usd_to_eur (nunca por
    debajo del cambio real) y redondeado HACIA ARRIBA al `step`. Función pura."""
    usd = Decimal(str(usd_max))
    fx = Decimal(str(fx_usd_to_eur))
    margin = Decimal(str(margin))
    step = Decimal(str(step))
    if (not usd.is_finite() or not fx.is_finite() or not margin.is_finite()
            or not step.is_finite() or usd < 0 or fx <= 0 or margin < 0 or step <= 0):
        raise ValueError('Importe, tipo de cambio, margen o paso no válidos para el € aproximado.')
    return _ceil_to_step(usd * fx * (Decimal('1') + margin), step)


def eur_display_max(*, usd_max=None, eur_sku_total=None, fx_usd_to_eur=None,
                    margin=EUR_MARGIN_PROPOSED, step=EUR_ROUNDING_STEP):
    """Máximo en € a presentar, SIEMPRE hacia arriba. PRIMARIA si `eur_sku_total` (precio EUR por SKU
    de Google) está disponible: techo al paso, sin margen de cambio (ya es EUR real). Si no, RESPALDO:
    convierte el máximo EXACTO en USD con el cambio del BCE + margen + techo. Nunca por debajo del real."""
    if eur_sku_total is not None:
        value = Decimal(str(eur_sku_total))
        step = Decimal(str(step))
        if not value.is_finite() or value < 0 or not step.is_finite() or step <= 0:
            raise ValueError('Precio EUR por SKU o paso no válidos.')
        return _ceil_to_step(value, step)
    if usd_max is None or fx_usd_to_eur is None:
        raise ValueError('Para el respaldo del € hacen falta el máximo USD y el cambio.')
    return eur_ceiling_from_usd(usd_max, fx_usd_to_eur, margin=margin, step=step)
