export const DEFAULT_ORG_SETTINGS = {
    legalEntityName: '',
    returnAddress: '',
    timesheetAddress: '',
    reportingTime: '9:30 AM',
    acceptanceDeadlineDays: 7,
    annualLeaveDays: 21,
    noticePeriodDays: 30,
    reviewPeriodMonths: 12,
};
export const EMPLOYMENT_CLAUSE_PAGES = [
    `<p>Income Tax, Professional Tax and other applicable taxes shall be deducted from the salary on a monthly basis as per Government Policy.</p>
<p>The salary will be processed on 7th Working day of every month. However, if the 7th falls on a holiday, salary will be paid on the next working day. The monthly pay slips will be made available electronically.</p>
<p>If the joining date is after 20th of the month first salary will be processed along with the next payroll.</p>
<p>Salary will be disbursed on receipt of your PAN card number.</p>`,
    `<h3>TIME SHEETS</h3>
<p>Shall send a hard copy/soft copy of the time sheets duly approved and signed by your Supervisor one business day in advance for processing salary every month{{timesheetAddressSuffix}}.</p>
{{timesheetAddressBlock}}
<p>Delay in receiving the approved time sheets will result in a delay in payment of your salary.</p>
<h3>STATUTORY BENEFITS</h3>
<p>You will be governed as per the respective acts of ESIC, PF, Bonus &amp; Gratuity, as per the rules in force, from time to time.</p>
<h3>BACKGROUND CHECK</h3>
<p>The Company reserves the right to verify the information furnished by you in your application for employment and through other documents. If it is found that you have misrepresented any information in your application for employment or have furnished any false information or have concealed / suppressed any relevant material facts, your services are liable to be terminated any time, without any notice or compensation in lieu thereof.</p>
<h3>MEDICAL CHECK</h3>
<p>As per the Company policy, employees are required to undergo medical check on request at authorized medical centers and submit a duly certified copy of the medical certificate.</p>
<h3>NO-SHOW</h3>
<p>Failure to report at the specified office on the {{joiningDateFormatted}} shall be deemed as "No-Show".</p>
<h3>JOB ROLES &amp; RESPONSIBILITIES</h3>
<p>You shall be responsible for the performance of the functions expected of {{positionTitle}} and any additional functions and duties that may be assigned to you in connection with the business and operations of the Company.</p>
<p>You shall use the best of your efforts to promote, develop and extend the business of the Company and comply with the directions and regulations of the Company at all times, and in all respects.</p>`,
    `<h3>REVIEW PERIOD</h3>
<p>Your performance will be reviewed to consider salary revision after {{reviewPeriodMonths}} months from the date of joining.</p>
<h3>ASSIGNMENT</h3>
<p>You shall acknowledge that the services to be rendered by you are unique and personal. During your service with the Company, you shall not assign any of the rights or delegate any of the duties or obligations under this Agreement without the prior written consent of the Company.</p>
<h3>LEAVE</h3>
<p>You would be entitled to get maximum of {{annualLeaveDays}} days of leaves per year. (pro rata bases)</p>
<h3>HOLIDAYS</h3>
<p>As each region may have a different set of holidays, your holiday schedule will be governed by your office location.</p>
<h3>DOCUMENTATION</h3>
<p>Upon being so required by the Company, you shall make, sign and execute all deeds, documents, and declarations as may be deemed necessary by the Company and/or its clients (including privacy and confidentiality agreements).</p>
<h3>INDEMNITY</h3>
<p>You shall keep the Company indemnified for any damages, which the Company or its client may suffer due to any act/acts by you including breach of any terms of this agreement.</p>
<h3>UN-AUTHORIZED ABSENCE</h3>
<p>Any absence for 3 consecutive business days without prior permission will be treated as un-authorized absence from the work. In such a case, the Company is entitled to terminate your services and/or seek compensation for any loss suffered by the Company or its Client due to such an absence.</p>`,
    `<h3>CONFIDENTIALITY &amp; NON DISCLOSURE</h3>
<p>You hereby acknowledge that by the reason of your services with the Company you will have access to records, documents, drawings, forms, reports, studies, memoranda, correspondence, manuals, plans, magnetic media and other information sources ("Confidential Material") and such Confidential Material constitutes the property of the Company and/or its clients, enables the Company and/or its clients to compete successfully in business and was acquired or created by the Company and/or its clients at substantial expense. In consideration of your services and the above disclosures, you agree that you will not disclose any Proprietary Material to any unauthorized person during or after the completion of services with the Company.</p>
<h3>NON COMPETE &amp; NON SOLICITATION</h3>
<p>You agree that during your services with the Company and continuing for a period of twelve (12) months after termination of your services with the Company, you will not solicit clients of the Company, seek employment with clients without written permission, or hire other employees of the Company.</p>
<h3>WAIVER</h3>
<p>A waiver by the Company of a breach of any provision of this Agreement by you shall not operate or be construed as a waiver or estoppel of any subsequent breach by you. No waiver shall be valid unless in writing and signed by an authorized officer of the Company.</p>
<h3>JURISDICTION</h3>
<p>In case of any dispute arising out of the Agreement, it shall be subject to jurisdiction of appropriate Court of Bangalore, Karnataka, India.</p>`,
    `<h3>LEAVING THE COMPANY WITHOUT SERVING NOTICE PERIOD</h3>
<p>If you wish to leave the services of the Company, a clear written notice of {{noticePeriodDays}} days has to be given to the Company.</p>
<h3>TERMINATION BY THE COMPANY</h3>
<p>The company may terminate your services with or without cause under the conditions described in the Employment Agreement.</p>
<h3>TERMINATION BY EMPLOYEE</h3>
<p>If you wish to leave the services of the Company, a clear written notice of {{noticePeriodDays}} days has to be given to the Company.</p>
<h3>MORAL CONDUCT</h3>
<p>You shall not resort to or in any way abet any form of strike or coercion or physical duress in connection with any matter pertaining to your service or the service of any other employee.</p>
<h3>ALTERNATIVE EMPLOYMENT</h3>
<p>You will be a whole time employee of the Company and will not engage yourself directly or indirectly in any other trade, business, profession or any other employment whilst in the services of the Company.</p>
<h3>COMPANY PROPERTIES IN YOUR POSSESSION</h3>
<p>You are expected to take proper care of company properties entrusted to you by the company. In the event of your resignation/termination you are obliged to return all the company's property in your possession in good condition.</p>
<h3>CHANGE OF ADDRESS</h3>
<p>Any change of residential address should be intimated to the department head in writing within 3 days from the date of such change.</p>
<h3>CODE OF CONDUCT</h3>
<p>During your services with us, you are expected to behave and perform in a manner that preserves the Company's and its Client's values and commitments.</p>
<h3>PLACE OF EMPLOYMENT AND TRANSFER</h3>
<p>You acknowledge and agree that you may be assigned, or liable to be transferred or deputed from one place to another and / or from one department / unit to another anywhere in India or abroad purely at the discretion of the management.</p>`,
];
