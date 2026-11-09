-- R5B-DEMO01: Police rank master; additive, no mutation of personnel rows.
CREATE TABLE IF NOT EXISTS sdl_polri_rank_master (
 code VARCHAR(16) PRIMARY KEY,
 short_name VARCHAR(40) NOT NULL,
 full_name VARCHAR(100) NOT NULL,
 rank_group VARCHAR(32) NOT NULL,
 sort_order SMALLINT NOT NULL UNIQUE,
 is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO sdl_polri_rank_master(code,short_name,full_name,rank_group,sort_order) VALUES
('BHARADA','Bharada','Bhayangkara Dua','Tamtama',1),
('BHARATU','Bharatu','Bhayangkara Satu','Tamtama',2),
('BHARAKA','Bharaka','Bhayangkara Kepala','Tamtama',3),
('ABRIPDA','Abripda','Ajun Brigadir Polisi Dua','Tamtama',4),
('ABRIPTU','Abriptu','Ajun Brigadir Polisi Satu','Tamtama',5),
('ABRIP','Abrip','Ajun Brigadir Polisi','Tamtama',6),
('BRIPDA','Bripda','Brigadir Polisi Dua','Bintara',7),
('BRIPTU','Briptu','Brigadir Polisi Satu','Bintara',8),
('BRIGPOL','Brigpol','Brigadir Polisi','Bintara',9),
('BRIPKA','Bripka','Brigadir Polisi Kepala','Bintara',10),
('AIPDA','Aipda','Ajun Inspektur Polisi Dua','Bintara',11),
('AIPTU','Aiptu','Ajun Inspektur Polisi Satu','Bintara',12),
('IPDA','Ipda','Inspektur Polisi Dua','Perwira Pertama',13),
('IPTU','Iptu','Inspektur Polisi Satu','Perwira Pertama',14),
('AKP','AKP','Ajun Komisaris Polisi','Perwira Pertama',15),
('KOMPOL','Kompol','Komisaris Polisi','Perwira Menengah',16),
('AKBP','AKBP','Ajun Komisaris Besar Polisi','Perwira Menengah',17),
('KOMBES','Kombes Pol','Komisaris Besar Polisi','Perwira Menengah',18),
('BRIGJEN','Brigjen Pol','Brigadir Jenderal Polisi','Perwira Tinggi',19),
('IRJEN','Irjen Pol','Inspektur Jenderal Polisi','Perwira Tinggi',20),
('KOMJEN','Komjen Pol','Komisaris Jenderal Polisi','Perwira Tinggi',21),
('JENDERAL','Jenderal Polisi','Jenderal Polisi','Perwira Tinggi',22)
ON CONFLICT (code) DO NOTHING;
