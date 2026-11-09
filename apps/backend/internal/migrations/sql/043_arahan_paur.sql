-- R5H4: Paur di dalam Subbagsumda, sebagai tujuan arahan Kabagrenmin.
--
-- Paur BUKAN unit organisasi. sdl_org_units tetap empat baris, karena setiap
-- grant, scope Engine A/B, dan penyaringan SQL di seluruh aplikasi bersandar
-- pada unit; menambah unit berarti setiap akun Paur kehilangan aksesnya ke data
-- Subbagsumda sampai grant-nya ditulis ulang. Paur hanyalah pengelompokan
-- ORANG di dalam satu unit, dan satu-satunya yang membacanya adalah pemilihan
-- penerima arahan (directives/sections.go ↔ modules/directives/sections.js).
--
-- Akibatnya keanggotaan Paur tidak memberi akses apa pun. Ia hanya menjawab
-- "siapa yang ikut menerima arahan bila Paur ini dipilih".
--
-- Daftar Paur ditulis di sini DAN di kode bagian (kunci dan label yang sama;
-- sections_test memastikan kodenya, layar admin membaca labelnya dari sini).

CREATE TABLE sdl_paur (
 paur_key VARCHAR(32) PRIMARY KEY CHECK (paur_key ~ '^paur_[a-z]{2,24}$'),
 unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 label VARCHAR(60) NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 60),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sdl_paur(paur_key,unit_key,label) VALUES
 ('paur_sumda','subbagsumda','Paur Sumda'),
 ('paur_log','subbagsumda','Paur Log'),
 ('paur_ada','subbagsumda','Paur ADA')
ON CONFLICT (paur_key) DO NOTHING;

-- Satu orang, paling banyak satu Paur (PRIMARY KEY user_id). is_head menandai
-- kepala Paur; ia tidak mengubah siapa yang menerima arahan (kepala dan staf
-- sama-sama anggota), hanya ditampilkan.
--
-- Syarat "anggota Paur harus anggota unit Paur-nya" ditegakkan di handler
-- admin, bukan di sini: sdl_user_units bisa berubah sesudahnya, dan pemilihan
-- penerima arahan memeriksa ulang keanggotaan unit pada saat kirim.
CREATE TABLE sdl_user_paur (
 user_id UUID PRIMARY KEY REFERENCES sdl_users(id) ON DELETE RESTRICT,
 paur_key VARCHAR(32) NOT NULL REFERENCES sdl_paur(paur_key) ON DELETE RESTRICT,
 is_head BOOLEAN NOT NULL DEFAULT FALSE,
 assigned_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_user_paur_paur_idx ON sdl_user_paur(paur_key);
