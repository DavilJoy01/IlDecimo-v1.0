-- The profile-images bucket had no allowed_mime_types or file_size_limit,
-- so RLS constrained *where* an authenticated user could write but not
-- *what* -- an arbitrary content-type up to the project-global size limit.
-- The client always uploads JPEGs; enforce that server-side too.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png'],
    file_size_limit = 5 * 1024 * 1024
where id = 'profile-images';
