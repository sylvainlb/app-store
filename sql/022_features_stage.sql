-- Chantier 3 (app-ui-component-editor) — RATIFIED at J8: app-store-spec v0.5 §1.4.3 (two-stage store).
-- Two-stage app store (spec §1): adds the discriminant column of the component stage and the local
-- of the versioned document IRI on the catalogue line of the declarative stage (F6).
-- Additive only: the code stage (stage='code', existing 12 features) is untouched — criterion C8.
--
-- Ratified at J8: dedicated column (not config_schema).
-- Queryable, hash-checkable, consistent with the v2 columns.

ALTER TABLE app.features ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'code'
  CHECK (stage IN ('code', 'declarative'));
-- Discriminant column of the component nature (spec §1). Existing rows keep 'code' (default).

ALTER TABLE app.features ADD COLUMN IF NOT EXISTS document_iri text NULL;
-- Declarative stage only: IRI of the pinned, versioned component document (F6, R2.2).
-- NULL for code-stage rows. The document hash is carried by the existing `sri` column
-- (sha384, same mechanics as the bundle SRI — spec §1 "vérification de hachage avant chargement").

-- Index for the store UI sections (F4: category column x stage discriminant).
CREATE INDEX IF NOT EXISTS features_stage_idx ON app.features (stage);

COMMENT ON COLUMN app.features.stage IS 'two-stage store discriminant: code (SRI bundle) | declarative (JSON-LD document)';
COMMENT ON COLUMN app.features.document_iri IS 'declarative stage: versioned component document IRI; NULL on code stage';
