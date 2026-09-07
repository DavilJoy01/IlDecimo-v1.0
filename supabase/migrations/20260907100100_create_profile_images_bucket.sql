insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true);

create policy "profile_images_public_read"
  on storage.objects for select
  using (bucket_id = 'profile-images');

create policy "profile_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
