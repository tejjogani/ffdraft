-- Imported bodies used to contribute their fallback alloy to cached casting totals.
UPDATE piece AS p
SET facts = NULL
WHERE facts IS NOT NULL AND EXISTS (
  SELECT 1 FROM jsonb_each(p.design->'nodes') AS feature(id, node)
  WHERE node->>'kind' = 'meshBody'
    AND node->'source'->>'type' = 'asset'
    AND node->'source' ?| ARRAY['rhinoLayer', 'rhinoObjectId', 'rhinoInstancePath', 'nativeAssetId']
);
