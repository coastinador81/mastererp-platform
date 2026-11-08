"""La API habilitada no demuestra que exista un bucket privado apto."""

import pytest

from app.creative_bucket_readiness import bucket_metadata_endpoint, check_bucket


BUCKET = 'uonify-private-media'


def metadata():
    return {'name': BUCKET, 'location': 'EUROPE-WEST1',
            'iamConfiguration': {
                'uniformBucketLevelAccess': {'enabled': True},
                'publicAccessPrevention': 'enforced'},
            'versioning': {'enabled': True}}


def test_private_bucket_readiness_requires_all_known_controls():
    assert bucket_metadata_endpoint(BUCKET).endswith('/b/' + BUCKET)
    assert check_bucket(metadata(), BUCKET, 'EUROPE-WEST1').ready
    inherited = metadata()
    inherited['iamConfiguration']['publicAccessPrevention'] = 'inherited'
    result = check_bucket(inherited, BUCKET, 'EUROPE-WEST1')
    assert not result.ready and 'prevención pública explícita' in result.missing
    wrong_region = check_bucket(metadata(), BUCKET, 'EUROPE-SOUTHWEST1')
    assert not wrong_region.ready and 'ubicación esperada' in wrong_region.missing


def test_foreign_bucket_or_bad_name_is_rejected():
    with pytest.raises(ValueError, match='otro bucket'):
        check_bucket(metadata(), 'other-private-media', 'EUROPE-WEST1')
    with pytest.raises(ValueError, match='Bucket'):
        bucket_metadata_endpoint('../foreign')
