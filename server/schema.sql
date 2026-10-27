-- Applied automatically when the server starts. Safe to re-run.
create table if not exists recipes (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    created_by text not null,
    title text not null,
    source_url text,
    note text,
    photo text
);

-- Recipes that are the same dish (cooked again) share a group_id; each starts in its own group.
alter table recipes add column if not exists group_id uuid not null default gen_random_uuid();

-- The photo's size as shown (after EXIF rotation), so the app can lay out the grid before it loads.
alter table recipes add column if not exists photo_width integer;
alter table recipes add column if not exists photo_height integer;

-- Each person rates each recipe once. Scores come from where it sits in
-- that person's bucket, so the two people's rankings never interfere.
create table if not exists ratings (
    recipe_id uuid not null references recipes (id) on delete cascade,
    person text not null,
    created_at timestamptz not null default now(),
    bucket text not null check (bucket in ('loved', 'fine', 'disliked')),
    -- Higher = better within (person, bucket). New ratings take the midpoint
    -- of their neighbors, so nothing is renumbered.
    position double precision not null,
    primary key (recipe_id, person)
);

create index if not exists ratings_person_bucket_position
    on ratings (person, bucket, position desc);

-- Migrate from the first version, where each recipe held one person's rating.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'recipes' and column_name = 'bucket'
    ) then
        insert into ratings (recipe_id, person, created_at, bucket, position)
            select id, person, created_at, bucket, position from recipes
            on conflict do nothing;
        alter table recipes drop column bucket, drop column position;
        alter table recipes rename column person to created_by;
        drop index if exists recipes_person_bucket_position;
    end if;
end $$;
