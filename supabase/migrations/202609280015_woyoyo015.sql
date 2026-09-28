-- WOYOYO-015: allow PDF attachments in chat; existing files and accounts are retained.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp','video/mp4','video/quicktime','video/webm','application/pdf'],
    file_size_limit = greatest(coalesce(file_size_limit, 0), 78643200)
where id = 'stoyangu-posts';
