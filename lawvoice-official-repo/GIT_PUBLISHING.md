# Git Publishing

## Local repository

If this directory was generated without `-InitGitRepo`, initialize it with:

```powershell
git init -b main
```

## First publish flow

1. Review the content and confirm the intended license.
2. Create a public or private remote repository.
3. Run:

```powershell
git add .
git commit -m "Prepare official LawVoice publication package"
git remote add origin <REMOTE_URL>
git push -u origin main
```
