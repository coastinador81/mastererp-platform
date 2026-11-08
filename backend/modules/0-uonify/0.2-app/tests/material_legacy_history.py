"""Decisiones previas al cambio de preguntas, para probar su conservación real."""
from copy import deepcopy
from app.products import find, present
from app.product_materials_review import groups_of
from app.product_materials_guide import ACCEPT, apply_proposals, persist_review


def seed_previous_review(database, service, user_id, sku, job_id, choose=None):
    with database.connect() as connection:
        user = connection.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
        job = service.get(connection, user, sku, job_id)['job']
        product = present(find(connection, user, sku))
        proposals = deepcopy(job['facts']['proposals'])
        groups = groups_of(proposals)
        answers = {'review_action': ACCEPT, **{
            f'p{index}': choose(group[0]) if choose else group[0]['value']
            for index, group in enumerate(groups)}}
        product = apply_proposals(connection, user, product, groups, answers)
        for group in groups:
            for fact in group:
                fact['reviewedRevision'] = product['revision']
        persist_review(service, connection, user, sku, job_id, job, proposals)
        return product
