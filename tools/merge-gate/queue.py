#!/usr/bin/env python3
"""Deliberate Dayflow queue actions; inspect never mutates GitHub. Python stdlib only."""
import argparse, datetime, hashlib, json, pathlib, re, subprocess, sys
REPO = 'Zihao-Qi/Dayflow'
OLD = {68:'b9ae268bde', 69:'6f9fc07cc4'}
class Blocked(RuntimeError): pass

def run(args):
    p = subprocess.run(args, text=True, capture_output=True, timeout=120)
    if p.returncode:
        raise Blocked(f'Command failed ({p.returncode}): {args[:4]}: {p.stderr.strip()}')
    return p.stdout

def api(path, pages=False):
    args=['gh','api',path]
    if pages: args += ['--paginate','--slurp']
    try: value=json.loads(run(args))
    except (ValueError, subprocess.TimeoutExpired) as e: raise Blocked(f'API unavailable: {e}') from e
    if isinstance(value,dict) and value.get('errors'): raise Blocked('GraphQL errors: '+str(value['errors']))
    return value

def graphql(query, **variables):
    args=['gh','api','graphql','-f','query='+query]
    for key,value in variables.items():
        args += ['-F' if isinstance(value,int) else '-f', f'{key}={value}']
    try: result=json.loads(run(args))
    except ValueError as e: raise Blocked('Malformed GraphQL response') from e
    if result.get('errors') or 'data' not in result: raise Blocked('GraphQL errors: '+str(result))
    return result['data']['repository']['pullRequest']

def pages(path):
    batches=api(path,pages=True)
    if not isinstance(batches,list) or any(not isinstance(b,list) for b in batches): raise Blocked('Unexpected paginated response')
    return [item for batch in batches for item in batch]

def fingerprint(item):
    return hashlib.sha256(json.dumps(item,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def discussions(number):
    # Thread outer and comment inner connections are BOTH paginated.
    result=[]; cursor=None
    while True:
        query='''query($n:Int!,$cursor:String){repository(owner:"Zihao-Qi",name:"Dayflow"){pullRequest(number:$n){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated comments(first:100){nodes{id body createdAt updatedAt author{login}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}'''
        variables={'n':number}
        if cursor: variables['cursor']=cursor
        conn=graphql(query,**variables)['reviewThreads']
        for thread in conn['nodes']:
            comments=thread['comments']['nodes']; info=thread['comments']['pageInfo']
            while info['hasNextPage']:
                # Node query because nested cursor differs for every thread.
                q='query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{id body createdAt updatedAt author{login}} pageInfo{hasNextPage endCursor}}}}}'
                raw=json.loads(run(['gh','api','graphql','-f','query='+q,'-f','id='+thread['id'],'-f','cursor='+info['endCursor']]))
                if raw.get('errors'): raise Blocked(str(raw['errors']))
                more=raw['data']['node']['comments']; comments+=more['nodes']; info=more['pageInfo']
            item={'id':thread['id'],'kind':'thread','resolved':thread['isResolved'],'outdated':thread['isOutdated'],'comments':comments}
            item['fingerprint']=fingerprint(item); result.append(item)
        info=conn['pageInfo']
        if not info['hasNextPage']: break
        cursor=info['endCursor']
    for c in pages(f'repos/{REPO}/issues/{number}/comments?per_page=100'):
        item={'id':'comment:'+str(c['id']),'kind':'comment','body':c['body'],'author':c['user']['login'],'created_at':c['created_at'],'updated_at':c['updated_at']}
        item['fingerprint']=fingerprint(item); result.append(item)
    for r in pages(f'repos/{REPO}/pulls/{number}/reviews?per_page=100'):
        item={'id':'review:'+str(r['id']),'kind':'review','body':r['body'],'state':r['state'],'commit_id':r['commit_id'],'submitted_at':r.get('submitted_at'),'author':r['user']['login']}
        item['fingerprint']=fingerprint(item); result.append(item)
    return result

def snapshot(number):
    p=api(f'repos/{REPO}/pulls/{number}')
    main=api(f'repos/{REPO}/git/ref/heads/main')['object']['sha']
    s={'number':number,'state': 'MERGED' if p.get('merged') else p['state'].upper(),'draft':p['draft'],'head_sha':p['head']['sha'],'base_sha':main,'target':p['base']['ref'],'mergeable_state':p.get('mergeable_state'),'url':p['html_url']}
    if s['state']=='MERGED': return s
    cmp=api(f'repos/{REPO}/compare/{main}...{s["head_sha"]}')
    s['behind_by']=cmp['behind_by']
    rules=api(f'repos/{REPO}/rules/branches/main')
    checks=[]; strict=False
    for r in rules:
        if r['type']=='required_status_checks':
            strict |= r['parameters']['strict_required_status_checks_policy']
            checks += r['parameters']['required_status_checks']
    s['required_checks']=checks; s['strict']=strict
    check_pages=api(f'repos/{REPO}/commits/{s["head_sha"]}/check-runs?per_page=100&filter=latest',pages=True)
    s['checks']=[{'id':c['id'],'name':c['name'],'head_sha':c['head_sha'],'app_id':c['app']['id'],'status':c['status'],'conclusion':c['conclusion'],'url':c['html_url']} for batch in check_pages for c in batch['check_runs']]
    s['statuses']=pages(f'repos/{REPO}/commits/{s["head_sha"]}/statuses?per_page=100')
    s['discussions']=discussions(number)
    return s

def eligible(s):
    if s['state']=='MERGED': return False
    if s['number']==70: raise Blocked('#70 is permanently excluded from this migration queue')
    if s['number'] in OLD and s['head_sha'].startswith(OLD[s['number']]): raise Blocked('Old unreconstructed #68/#69 head is blocked')
    if s['state']!='OPEN' or s['draft']: raise Blocked('PR must be open and non-draft')
    return True

def review_gate(s,evidence):
    if not evidence: raise Blocked('Provide review evidence or an explicit discussion-triage ledger')
    if evidence.get('head_sha')!=s['head_sha'] or evidence.get('base_sha')!=s['base_sha'] or evidence.get('number')!=s['number']: raise Blocked('Review/triage evidence has stale PR/head/base')
    if evidence.get('findings'): raise Blocked('Independent review has findings')
    if s['number'] in OLD and not (evidence.get('rebuilt_candidate') is True and evidence.get('verdict')=='clean' and evidence.get('rebuild_summary','').strip()): raise Blocked('#68/#69 require explicit pinned independently reviewed rebuilt candidate evidence')
    observed={d['id']:d['fingerprint'] for d in s['discussions']}
    known=evidence.get('discussion_fingerprints',{})
    if any(known.get(k)!=v for k,v in observed.items()): raise Blocked('New or edited untriaged discussion/review activity')
    # Historical unresolved findings need explicit disposition, never automatic dismissal.
    triage={x['id']:x for x in evidence.get('triage',[])}
    for d in s['discussions']:
        is_finding=(d['kind']=='thread' and not d['resolved']) or (d['kind']=='review' and d['state']=='CHANGES_REQUESTED')
        if is_finding:
            t=triage.get(d['id'],{})
            if t.get('fingerprint')!=d['fingerprint'] or t.get('disposition') not in ('fixed','obsolete','not-actionable') or not t.get('reason','').strip(): raise Blocked('Untriaged finding '+d['id'])
    if evidence.get('verdict')=='clean' and evidence.get('reviewer') and evidence.get('reviewed_at') and evidence.get('summary'):
        return
    # Bot comment must explicitly name reviewed commit, not accidentally mention SHA.
    for d in s['discussions']:
        if d['kind']=='comment' and d['author']=='chatgpt-codex-connector[bot]' and "Didn't find any major issues" in d['body']:
            match=re.search(r'\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`',d['body'])
            if match and len(match[1])>=10 and s['head_sha'].startswith(match[1]): return
    raise Blocked('No independent clean review or bot clean review tied to the exact inspected head')

def gate(s,evidence):
    if not eligible(s): return 'skip-merged'
    if s['target']!='main': raise Blocked('PR target must be main')
    if s['behind_by']!=0: raise Blocked('Head does not contain current main')
    if not s['strict'] or not any(r['context']=='Reliability gates' for r in s['required_checks']): raise Blocked('Expected strict server Reliability gates rule unavailable')
    if s['mergeable_state']!='clean': raise Blocked('GitHub merge state is not clean: '+str(s['mergeable_state']))
    for r in s['required_checks']:
        matching=[c for c in s['checks'] if c['name']==r['context'] and c['head_sha']==s['head_sha'] and (r.get('integration_id') is None or c['app_id']==r['integration_id'])]
        if matching:
            # A run cancelled by the workflow's cancel-in-progress concurrency group is
            # superseded history, not a signal, but only when a strictly later run for the
            # same context at the same head actually completed successfully. Any other
            # non-success conclusion, and any cancelled run that was never superseded,
            # still fails closed.
            best=max((c['id'] for c in matching if c['status']=='completed' and c['conclusion']=='success'),default=None)
            live=[c for c in matching if not (c['conclusion']=='cancelled' and best is not None and c['id']<best)]
            if not live or any(c['status']!='completed' or c['conclusion']!='success' for c in live): raise Blocked('Required check pending/failed: '+r['context'])
        elif r.get('integration_id') is None:
            matching=[c for c in s['statuses'] if c['context']==r['context']]
            if not matching or max(matching,key=lambda x:x['id'])['state']!='success': raise Blocked('Required status not successful: '+r['context'])
        else: raise Blocked('Missing required check: '+r['context'])
    review_gate(s,evidence)
    return 'ready'

def pin(s,head,base):
    if s['head_sha']!=head or s['base_sha']!=base: raise Blocked('Expected head/base changed; inspect and review again')

def act(action,number,expected_head=None,expected_base=None,evidence=None):
    first=snapshot(number)
    if action=='inspect':
        try: first['decision']=gate(first,evidence)
        except Blocked as e: first['decision']='blocked'; first['reason']=str(e)
        return first
    if not eligible(first): return {'decision':'skip-merged','number':number}
    pin(first,expected_head,expected_base)
    if action=='update':
        # Explicit update only. Never retarget implicitly; coordinator must decide dependency is satisfied.
        if first['target']!='main': raise Blocked('Retarget to main deliberately before update; this tool never retargets')
        second=snapshot(number); pin(second,expected_head,expected_base)
        if not eligible(second): return {'decision':'skip-merged','number':number}
        if second['target']!='main': raise Blocked('Base target changed')
        result=run(['gh','api','--method','PUT',f'repos/{REPO}/pulls/{number}/update-branch','-f','expected_head_sha='+expected_head])
        return {'decision':'updated-review-and-CI-now-stale','response':json.loads(result)}
    gate(first,evidence)
    # Immediately re-fetch all state (including named checks and discussions), then identity refs once more.
    second=snapshot(number); pin(second,expected_head,expected_base)
    if gate(second,evidence)=='skip-merged': return {'decision':'skip-merged','number':number}
    main=api(f'repos/{REPO}/git/ref/heads/main')['object']['sha']; p=api(f'repos/{REPO}/pulls/{number}')
    if main!=expected_base or p['head']['sha']!=expected_head or p['base']['ref']!='main' or p['draft'] or p['state']!='open': raise Blocked('PR/main changed immediately before merge')
    output=run(['gh','pr','merge',str(number),'--repo',REPO,'--merge','--match-head-commit',expected_head])
    after=api(f'repos/{REPO}/pulls/{number}')
    if not after.get('merged'): raise Blocked('Merge did not complete; inspect before retrying')
    return {'decision':'merged','merge_commit_sha':after['merge_commit_sha'],'output':output}

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('action',choices=['inspect','update','merge']); p.add_argument('number',type=int); p.add_argument('--expected-head'); p.add_argument('--expected-base'); p.add_argument('--evidence'); p.add_argument('--output')
    a=p.parse_args()
    if a.action!='inspect' and (not a.expected_head or not a.expected_base or any(not re.fullmatch('[0-9a-f]{40}',v) for v in [a.expected_head,a.expected_base])): p.error('Mutations require full --expected-head and --expected-base SHA')
    try:
        evidence=json.loads(pathlib.Path(a.evidence).read_text()) if a.evidence else None
        value=act(a.action,a.number,a.expected_head,a.expected_base,evidence)
        out=json.dumps(value,indent=2)+'\n'
        if a.output: pathlib.Path(a.output).write_text(out)
        else: print(out,end='')
        return 0
    except (Blocked,KeyError,TypeError,ValueError,OSError,subprocess.TimeoutExpired) as e:
        print(json.dumps({'decision':'blocked','error':str(e)}),file=sys.stderr); return 2
if __name__=='__main__': sys.exit(main())
