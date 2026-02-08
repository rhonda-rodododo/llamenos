# Llámenos

You're going to build an easy to use and secure-as possible hotline calling app for crisis response situations.
For now, it's a webapp. It will be used in North America to start. See technical notes.

## Specifications

### Hotline Personas

- Callers - someone dialing into the hotline using a regular GSM phone line
- Hotline Volunteers - the person on the receiving end of calls during their shift. they are receiving calls on their phone and are near a computer where they can enter information into a webapp they are signed into. They just need to note who called (this can be automated if they are signed in when the call arrives or is in progress, yeah?) and what they said. They can only see previous notes that they entered.
- Hotline Admins - someone who can add/remove people and their contact information from shifts, and manage shifts. They might also be a shift volunteer. Ideally a hotline admin is always available if someone needs to change phone numbers or be added/removed because of whatever circumstances. They can also see all notes, and manage ban lists. This is the most sensitive role. There can be multiple hotline admins, any volunteer can be made an admin.


### Must Haves:

- low cost billing - we are paying out of pocket, so ideally we can keep costs as low as possible. twilio is cheap, but an SIP trunk is even cheaper
- automated shift routing - the shifts (ring groups with scheduled times) need to route automatically on a predefined and modifiable, recurring schedule. a fallback group can exist if there accidentally is no schedule
- protects identity of hotline volunteers - their personal information (name, phone) should not be known by anyone but the Hotline Admins
- can mitigate call spam attacks - we used to in Oakland and other cities get spammed with mass dialing attacks where malicious actors (proud boys types) would use scripts to spam our hotlines, or even worse, would even spam as real people harassing/threatening the volunteers. We need hotline admins to be able to intake lists of numbers to ban, that are flagged by hotline users, in realtime. There are network level ways to protect against this as well, similar to how DDOS are mitigated. The quicker you mitigate these attacks, the less they are likely to try again. volunteers must be trained to anticipate this and hang up immediately. perhaps a voice bot detection, prompting for the caller to input a randomized, short number only for that call can be turned on by hotline admins. any other mitigations you can imagine are great.
- parallel calling - all shift volunteers (every user in a ring group) who aren't already on a call get a call at once, and whoever picks up terminates the other calls.
- call transcription would be nice, even using OpenWhisper model if possible, but it must all remain encrypted at rest at least, if not somehow e2ee with the server as the encryptor? is that possible? maybe we can let them fix the transcript once the call is done?
- audit log - admins can see every call a volunteer answered and all notes
- visibility - admins can see who is actively handling calls at any time, and can see data to plan for billing and usage from their TelephonyProvider

### Threat Modelling

- potential adversaries: nation states, right wing groups, private hacking firms, other malicious actors. most digital platforms are beholden to cooperate with these adversaries, so e2ee and zero knowledge is ideal
- what they're willing to spend: a lot
- what they want access to: personally identifying information of volunteers, activists calling in, and lead information on what they've witnessed, perhaps for strategic legal or operational advantage

They have already hacked some applications


## Technical Notes

- vite, tanstack start or just router, shadcnui using the component installer to keep it lean. does not need SSR of course
- deployment using cloudflare infrastructure (cloudflare workers, DOs, tunnels, etc), billed to an EU card (that I have) and with a GDPR-compatible account, as our parent organization is based in Germany
- nostr is a worthwhile choice, but we might need people to securely authenticate from other devices, thoughts on this?
- twilio can be used for the telephony layer, but let's implement it as a TelephonyAdapter so that other providers could be supported in the future
- use i18n by default, so we can add translations for other languages later
- only e2e tests should be necessary, you are so good at what you do these days, unit tests don't serve much purpose, do you agree?

## Claude Code Notes

- the repo is designed by and for claude code! no need to worry about humans using the repo yet, just the app
- you're an expert at whatever you're working on
- you use git commits and git log/history to keep a lean file tree. 
- you implement features completely and fully without taking shortcuts
- you don't create copies of files, you improve them, the git history will be there if you need to look back
- no need for legacy fallbacks or data migration as the codebase evolves - i will note in this file the day that this app is ever in production use, then the production SDLC comes into play

You will use whatever planning system makes the most sense to you, here are some ideas:
- keep a docs/NEXT_BACKLOG and docs/COMPLETED_BACKLOG
- plan out entire epics in an docs/epics/ directory, and execute on them and complete them when you're done
- use a planning methodology you reccomend that facilitates autonomous execution by claude code agents, even in parallel, so they can easily move through planning and development cycles and make efficient use of context, etc
- whatever else you reccomend!
