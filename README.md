# github-issue-transfer
for transition github repository 

## overview 
Forwarding the issue of another Owner's github

## prepare
* getting github api token (Forwarding user)

## detail

### init
* move milestone data
* move label data
* get milestone id
* move issue and issue comments
    * give milestones and labels to the issue
    * in case of a pull request, give a suffix to the title
    * output issue and comment to log

### retry
* Implementation of retry processing as there may be API errors when there are a large number of issues.
    * setting retryIssueNum

## usage
* npm install
* setting repoCnf
    * Source owner name and repository name
    * Owner name of the transfer destination and repository name
* setting users
    * UserName and github api token (key/value)
* setting defUserName
    * For users who exist only at the transfer source
* node app.js
