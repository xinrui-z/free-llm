// Fields the checker's public /api/catalog DTO exposes. The site's dynamic e2e fake server serves exactly
// these; the private checker repo asserts its real publicCatalog matches this list, so drift fails there.
// Internal fields (api_key_env, probe policies, review records) are never part of the public DTO.
export const providerFields = ['id','name','description','base_url','signup_url','website_url','logo','status','rpm','rpd','context_window','auth','tags','top_models','last_verified','catalog_checked_at','archive_reason','quota_note','catalog_note','sources','geo_restrictions','pricing_note'];
export const modelFields = ['id','name','context_window','modalities','rpm','rpd','status','pricing'];
