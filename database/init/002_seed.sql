INSERT INTO roles (code, name)
VALUES
    ('admin', '管理员'),
    ('member', '普通成员')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
