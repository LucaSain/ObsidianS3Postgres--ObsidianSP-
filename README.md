# ObsidianS3Postgres (ObsidianSP) (POC)

This is plugin to backup an obsidian vault to a postgres db with references to file stored in an s3 bucket. The fs is simulated using a tree.

Static files are stored in the Images folder. .excalidraw.md files are ignored bydefault.
all other files and folders are stored in the postgres with a reference to their id in the bucket.

Todo:

-   Explain the settings for the plugin
-   Add costumisation for the Static/Images folder
-   Support other databases, use a ORM
