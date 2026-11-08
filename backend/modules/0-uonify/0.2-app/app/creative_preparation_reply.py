"""Explica el estado guardado en el chat, sin exponer controles internos."""


_DECISIONS = {
    'elegir materiales aportados o creatividad de Uony': (
        'decidir si aportarás materiales o partimos desde cero',
        '¿Aportarás fotos o clips, o prefieres que proponga la creatividad desde cero?'),
    'elegir expresamente el modelo de vídeo': (
        'elegir el modelo de vídeo', '¿Qué modelo prefieres para el vídeo?'),
    'fijar la duración total': (
        'decidir la duración', '¿Cuánto quieres que dure el vídeo?'),
    'vincular evidencia auténtica; no fabricar prueba': (
        'aportar una reseña o resultados auténticos',
        '¿Qué reseña o resultados reales quieres utilizar?'),
    'definir CTA y destino real': (
        'definir qué debe hacer quien vea la pieza y a dónde irá',
        '¿Qué quieres que haga quien vea la pieza y a dónde debe dirigirse?'),
}


def preparation_reply(preparation, *, ask_next=True):
    if preparation is None:
        return ('Todavía no hay un plan creativo guardado en esta conversación.'
                + (' ¿Qué imagen o vídeo quieres preparar?' if ask_next else ''))
    if not preparation['sourceCurrent']:
        return ('El plan guardado necesita revisarse porque cambió su estado, el producto o el proyecto. '
                'Todavía no puedo darlo por vigente ni confirmar un presupuesto para generar medios.')
    decisions = []
    for item in preparation['missingInputs']:
        if item in _DECISIONS:
            decisions.append(_DECISIONS[item])
        elif item.startswith('vincular referencia '):
            reference = ('vincular los archivos reales que servirán de referencia',
                         '¿Qué archivos quieres utilizar como referencia?')
            if reference not in decisions:
                decisions.append(reference)
    pieces = ['El plan creativo está guardado y vigente.']
    if decisions:
        pieces.append('Falta ' + '; '.join(label for label, _ in decisions) + '.')
    else:
        pieces.append('La preparación de los recursos y la comprobación de la generación siguen pendientes.')
    pieces.append('Aún no hay un presupuesto máximo completo ni una generación autorizada o iniciada.')
    if decisions and ask_next:
        pieces.append(decisions[0][1])
    return ' '.join(pieces)
