import { parseSkillList } from './skills.js';
function experiencePhrase(min, max) {
    if (min != null && max != null) {
        if (min === max)
            return `${min}+ years`;
        return `${min}–${max} years`;
    }
    if (min != null)
        return `${min}+ years`;
    if (max != null)
        return `Up to ${max} years`;
    return 'Relevant professional experience';
}
function formatSkillList(skills) {
    if (skills.length === 0)
        return '';
    if (skills.length === 1)
        return skills[0];
    if (skills.length === 2)
        return `${skills[0]} and ${skills[1]}`;
    return `${skills.slice(0, -1).join(', ')}, and ${skills[skills.length - 1]}`;
}
function aboutTheRole(input) {
    const title = input.title.trim();
    const exp = experiencePhrase(input.experienceMinYears, input.experienceMaxYears);
    const dept = input.department?.trim();
    const deptPhrase = dept ? ` within the ${dept} team` : '';
    const skillHint = input.primarySkills.length > 0
        ? ` with strong expertise in ${formatSkillList(input.primarySkills.slice(0, 4))}`
        : '';
    switch (input.seniorityLevel) {
        case 'JUNIOR':
            return `We are looking for a ${title}${deptPhrase} to grow with our delivery team${skillHint}. This is a junior-level role suited for candidates with ${exp.toLowerCase()} who are eager to learn, ship quality work, and collaborate closely with senior engineers.`;
        case 'MID':
            return `We are hiring a ${title}${deptPhrase} to own features end-to-end${skillHint}. You will work with product and engineering partners to deliver reliable solutions and contribute to team practices. Ideal candidates bring ${exp.toLowerCase()} of hands-on, mid-level experience.`;
        case 'SENIOR':
            return `We are seeking a ${title}${deptPhrase} to drive meaningful outcomes${skillHint}. You will own complex workstreams, raise the bar on code quality and design, and mentor others on the team. ${exp} of experience in similar roles is expected.`;
        case 'LEAD':
            return `We are looking for a ${title}${deptPhrase} to set technical direction and guide delivery${skillHint}. You will partner with stakeholders, unblock the team, and ensure scalable, maintainable solutions. This lead role requires ${exp.toLowerCase()} including people or workstream leadership.`;
        case 'PRINCIPAL':
            return `We are hiring a ${title}${deptPhrase} to shape architecture and engineering standards${skillHint}. You will influence roadmap decisions, solve our hardest technical problems, and mentor leads across the organization. ${exp} of deep, principal-level experience is required.`;
        default:
            return `We are looking for a ${title}${deptPhrase}${skillHint}. Candidates should have ${exp.toLowerCase()} and a track record of delivering high-quality work.`;
    }
}
function responsibilityBullets(input) {
    const primary = input.primarySkills;
    const secondary = input.secondarySkills ?? [];
    const bullets = [];
    if (primary.length > 0) {
        bullets.push(`Design, build, and maintain solutions using ${formatSkillList(primary.slice(0, 5))}`);
        if (primary.length > 1) {
            bullets.push(`Apply best practices across ${formatSkillList(primary.slice(0, 3))} in production environments`);
        }
    }
    else {
        bullets.push('Deliver high-quality work aligned with team goals and client expectations');
    }
    switch (input.seniorityLevel) {
        case 'JUNIOR':
            bullets.push('Implement features and fixes with guidance from senior team members');
            bullets.push('Write clear code, tests, and documentation; participate in code reviews');
            break;
        case 'MID':
            bullets.push('Own feature delivery from requirements through deployment and support');
            bullets.push('Collaborate with product, QA, and peers to refine scope and acceptance criteria');
            break;
        case 'SENIOR':
            bullets.push('Lead technical design for assigned modules and drive cross-team alignment');
            bullets.push('Mentor junior and mid-level engineers through reviews and pairing');
            break;
        case 'LEAD':
            bullets.push('Set priorities for the squad, remove blockers, and report progress to stakeholders');
            bullets.push('Establish engineering standards, observability, and operational readiness');
            break;
        case 'PRINCIPAL':
            bullets.push('Define long-term architecture and guide multiple teams on critical initiatives');
            bullets.push('Partner with leadership on hiring, roadmap trade-offs, and platform investments');
            break;
        default:
            bullets.push('Collaborate with cross-functional partners to deliver on schedule');
    }
    if (secondary.length > 0) {
        bullets.push(`Leverage ${formatSkillList(secondary.slice(0, 4))} where they add delivery or quality advantages`);
    }
    return bullets.slice(0, 6);
}
function mustHaveBullets(input) {
    const exp = experiencePhrase(input.experienceMinYears, input.experienceMaxYears);
    const bullets = [`${exp} of professional experience as a ${input.title.trim() || 'professional in this domain'}`];
    for (const skill of input.primarySkills.slice(0, 6)) {
        bullets.push(`Hands-on, production experience with ${skill}`);
    }
    if (input.seniorityLevel === 'JUNIOR') {
        bullets.push('Strong fundamentals, willingness to learn, and clear written communication');
    }
    else if (input.seniorityLevel === 'SENIOR' || input.seniorityLevel === 'LEAD') {
        bullets.push('Proven ability to mentor others and communicate trade-offs to non-technical stakeholders');
    }
    else if (input.seniorityLevel === 'PRINCIPAL') {
        bullets.push('Demonstrated impact on architecture, reliability, or org-wide engineering practices');
    }
    else {
        bullets.push('Ability to work independently and communicate progress clearly');
    }
    return bullets;
}
function goodToHaveBullets(input) {
    const bullets = (input.secondarySkills ?? []).slice(0, 8).map((skill) => `Experience with ${skill}`);
    if (bullets.length === 0 && input.primarySkills.length > 0) {
        bullets.push('Exposure to adjacent tools and practices in the same ecosystem');
    }
    if (input.seniorityLevel === 'LEAD' || input.seniorityLevel === 'PRINCIPAL') {
        bullets.push('Prior experience leading teams or large initiatives in a client-facing context');
    }
    return bullets.slice(0, 8);
}
function bulletSection(title, items) {
    if (items.length === 0)
        return '';
    return `${title}\n${items.map((item) => `• ${item}`).join('\n')}`;
}
/** Build a structured job description from role metadata and skills. */
export function generateJobDescription(input) {
    const title = input.title?.trim();
    if (!title || title.length < 3) {
        throw new Error('Job title must be at least 3 characters');
    }
    const primarySkills = parseSkillList(input.primarySkills);
    if (primarySkills.length === 0) {
        throw new Error('Select at least one primary skill before generating a job description');
    }
    const secondarySkills = parseSkillList(input.secondarySkills ?? []);
    const normalized = {
        ...input,
        title,
        primarySkills,
        secondarySkills,
    };
    const sections = [
        'About the role',
        aboutTheRole(normalized),
        bulletSection('Responsibilities', responsibilityBullets(normalized)),
        bulletSection('Must have', mustHaveBullets(normalized)),
        bulletSection('Good to have', goodToHaveBullets(normalized)),
    ].filter(Boolean);
    const text = sections.join('\n\n').trim();
    return text.slice(0, 50_000);
}
