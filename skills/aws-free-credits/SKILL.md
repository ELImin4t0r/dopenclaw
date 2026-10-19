---
name: aws-free-credits
description: "Guide the user through signing up for AWS and completing the Free Tier 'Explore AWS' activities that earn extra credits, using the aws CLI with a budget alert first and cleanup after every step."
homepage: https://aws.amazon.com/free/
metadata:
  {
    "openclaw":
      {
        "emoji": "☁️",
        "requires": { "bins": ["aws"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "awscli",
              "bins": ["aws"],
              "label": "Install the AWS CLI via Homebrew",
            },
          ],
      },
  }
---

# AWS free credits

Help the user create an AWS account and earn the Free Tier credits. AWS gives a
sign-up credit plus extra credits for completing a few starter activities
listed in the console's **Explore AWS** widget on the Console Home page.

Progress lives in `personal/aws-credits.md` in the workspace. Read it first and
update it after every step (`- [x] activity · date · notes`).

## Ground rules

- **The user does the human-verification steps.** Sign-up needs a CAPTCHA, a
  payment card, phone and email verification. Never try to solve, skip or
  automate these. Pause and ask the user to do them in the browser window.
- **Never ask for, print or store secrets** (passwords, card numbers, access
  keys) in chat, memory or markdown. CLI credentials live only in `~/.aws`.
- **Budget alert first.** Don't start any other activity until the budget exists.
- **Clean up.** Delete or stop every resource right after the activity counts.
  Leaving resources running is how free-tier accounts get billed.
- Use region `eu-central-1` (Frankfurt) unless the user prefers another.
- Before each billable step, say what you'll create and how you'll remove it,
  then wait for the user's OK.

## 1. Sign up (assisted)

1. Open `https://signin.aws.amazon.com/signup?request_type=register` with the
   browser tool. Fill in only email and account name from `USER.md`.
2. Tell the user to finish the steps themselves: email code, password, contact
   info, card, phone, CAPTCHA, and choosing the **Free** plan.
3. Ask the user to confirm when they see the Console Home page.

## 2. CLI access without long-lived keys

Walk the user through IAM Identity Center in the console: enable it, create a
user for themselves with the `AdministratorAccess` permission set, then on the
laptop:

```bash
aws configure sso          # session name: personal, region: eu-central-1
aws sts get-caller-identity --profile personal
```

Use `--profile personal` on every command below.

## 3. Activities

Check the **Explore AWS** widget first. The list changes, so follow what the
console shows. The usual ones:

| Activity | How |
| --- | --- |
| Set up a cost budget | `aws budgets create-budget` with a monthly $1 COST budget and an 80% ACTUAL email notification to the user's address. **Always first.** |
| Launch an EC2 instance | Launch the free-tier instance type the console marks "Free tier eligible" with the latest Amazon Linux AMI (`aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`). Wait until running, then `aws ec2 terminate-instances`. |
| Build a web app with Lambda | Create a minimal Python Lambda with a function URL (`aws lambda create-function`, `create-function-url-config --auth-type NONE`), `curl` it once, then delete the URL config and the function and its IAM role. |
| Create an RDS database | `aws rds create-db-instance` with the free-tier template (smallest db class the console marks free-tier, 20 GB, no Multi-AZ, `--no-publicly-accessible`). Wait for `available`, then `delete-db-instance --skip-final-snapshot --delete-automated-backups`. |
| Use a model in the Bedrock playground | Console-only: the user opens Amazon Bedrock → Playgrounds → Chat, picks an available model, and sends one prompt. Guide them; nothing to clean up. |

After each activity, ask the user to refresh the Explore AWS widget to confirm
the credit was granted, and record it.

## 4. Wrap up

- `aws ec2 describe-instances`, `aws rds describe-db-instances`,
  `aws lambda list-functions`: confirm nothing is left running.
- Remind the user the free plan has an end date. Add a reminder with the
  `reminder_add` tool one week before it, if they want one.
