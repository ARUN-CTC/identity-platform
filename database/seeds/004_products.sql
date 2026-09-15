-- Phase 2B (docs/PHASE_2B.md) — synthetic platform-catalog rows
-- demonstrating that the Identity Platform can register multiple
-- independent products without any of them being anything more than a name
-- and a slug here. Nothing about TravelOS's, Healthcare's, or Gym's actual
-- business data is imported or referenced — these are placeholder
-- registration records only, exactly the same "no real data" posture as
-- the DEV bootstrap tenant/admin seed.
INSERT INTO product (name, slug, description, status)
VALUES
    ('TravelOS',   'travelos',   'Travel booking and itinerary management', 'ACTIVE'),
    ('Healthcare', 'healthcare', 'Patient, appointment, and clinical records management', 'ACTIVE'),
    ('Gym',        'gym',        'Membership, trainer, and workout management', 'ACTIVE')
ON CONFLICT DO NOTHING;

-- One sample CONFIDENTIAL application per product, for local development/
-- testing of the registration API's read paths. client_secret_hash below is
-- the SHA-256 hash of the literal dev-only secret 'dev-client-secret-please-rotate'
-- — never use this value in any real environment; every real Application's
-- secret is generated fresh (and shown exactly once) by
-- ApplicationsService.create().
INSERT INTO application (product_id, name, client_id, client_secret_hash, client_type, secret_created_at)
SELECT p.id, p.name || ' Backend', 'cli_dev_' || p.slug, 'e27a292250ecd902bf81aaed8d5b29fcff2403cae3f2d63e273d63e996ce2a8b', 'CONFIDENTIAL', NOW()
FROM product p
WHERE p.slug IN ('travelos', 'healthcare', 'gym')
ON CONFLICT (product_id, name) DO NOTHING;
