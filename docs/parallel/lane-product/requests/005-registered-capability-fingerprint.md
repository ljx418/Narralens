# MAIN decided capability fingerprint seam

ProductProjectFacts.capability_fingerprint is now required lowercase64hex. Product RunPrepare consumes that actual MAIN fact directly and fails closed when missing/invalid; it does not synthesize descriptors or use fixed name hashes. Wire/DDL unchanged.

MAIN owns production catalog helper and provenance. Exact digest: SHA256(canonicalJson({schema_version:1,capabilities:descriptorsSortedById})). Each descriptor is {id,version:1,implementation_digest,configuration_digest}. A requires exactly clip.prepare/snapshot.render/qc.inspect/delivery.package, rejects duplicate/unknown IDs. Implementation digest covers actual assembled source/tool manifest closure; configuration digest covers actual fixed upstream/renderer/toolchain/profile. No PRODUCT fixture hash is production provenance.

This is a preparation fact; the same actual capability/config fingerprint and action/ref/rights/snapshot scope must be rechecked by MAIN at authorization and actual serialized side-effect boundary. Existing committed snapshot render is not rebound to latest revision.

Unit tests verify mandatory field/malformed rejection and exact supplied value in RunScope; real descriptor catalog and cross-lane Host evidence remain MAIN responsibility.
