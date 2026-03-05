mkdir -p /tmp/glab-test && cd /tmp/glab-test
git init
git remote add origin https://gitlab.com/gitlab-org/cli.git
glab issue list --assignee @me --label bug -O json 2>&1
