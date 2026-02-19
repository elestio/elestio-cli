import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { formatTable, colors, log, outputJson } from '../utils.js';

export async function getBillingSummary(json = false) {
  const projectsResponse = await apiRequest('/api/projects/getList');
  const projects = projectsResponse.data?.projects || [];

  if (projects.length === 0) {
    log('info', 'No projects found');
    return { data: {}, totalMonthly: 0, totalServices: 0 };
  }

  let totalMonthly = 0;
  let totalServices = 0;
  let totalSpent = 0;
  const data = {};

  for (const project of projects) {
    try {
      const response = await apiRequest('/api/billings/getProjectBillings', 'POST', {
        projectId: String(project.projectID)
      });

      if (response.status === 'OK' && response.data) {
        const billing = response.data;
        const monthly = parseFloat(billing.monthlyCost) || (parseFloat(billing.costPerHour) * 720);
        totalMonthly += monthly;
        totalServices += billing.nbServices || 0;
        totalSpent += parseFloat(billing.totalFromBeginning) || 0;
        data[project.projectID] = { ...billing, projectName: project.project_name };
      }
    } catch { /* skip */ }
  }

  const summary = { data, totalMonthly, totalServices, totalSpent };

  if (json) {
    outputJson(summary);
    return summary;
  }

  console.log(`\n${colors.bold}Billing Summary${colors.reset}\n`);

  Object.entries(data).forEach(([pid, billing]) => {
    const monthly = parseFloat(billing.monthlyCost) || (parseFloat(billing.costPerHour) * 720);
    console.log(`  ${colors.cyan}${billing.projectName}${colors.reset} (ID: ${pid})`);
    console.log(`    Services: ${billing.nbServices || 0}`);
    console.log(`    Cost/hour: $${billing.costPerHour || '0.0000'}`);
    console.log(`    Est. Monthly: $${monthly.toFixed(2)}`);
    console.log(`    Total Spent: $${billing.totalFromBeginning || '0.00'}`);
    console.log('');
  });

  console.log(`${colors.bold}Total${colors.reset}`);
  console.log(`  Services: ${totalServices}`);
  console.log(`  Est. Monthly: ${colors.green}$${totalMonthly.toFixed(2)}${colors.reset}`);
  console.log(`  Total Spent: $${totalSpent.toFixed(2)}`);
  console.log('');
  return summary;
}

export async function getProjectBilling(projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/billings/getProjectBillings', 'POST', { projectId: String(pid) });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');

  const billing = response.data || {};
  const services = billing.boardInformations || [];

  if (json) { outputJson(billing); return billing; }

  console.log(`\n${colors.bold}Project ${pid} Billing${colors.reset}\n`);
  console.log(`  Services: ${billing.nbServices || 0}`);
  console.log(`  Volumes: ${billing.nbVolumes || 0}`);
  console.log(`  Cost/hour: $${billing.costPerHour || '0.0000'}`);
  console.log(`  Est. Monthly: ${colors.green}$${billing.monthlyCost || '0.00'}${colors.reset}`);
  console.log(`  Total Spent: $${billing.totalFromBeginning || '0.00'}`);

  if (services.length > 0) {
    const columns = [
      { key: 'displayName', label: 'Service' },
      { key: 'resourceType', label: 'Type' },
      { key: 'nbHoursUsed', label: 'Hours' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' }
    ];

    const data = services.map(s => ({
      displayName: s.displayName || 'N/A',
      resourceType: s.resourceType || 'VM',
      nbHoursUsed: s.nbHoursUsed || 0,
      amount: `$${parseFloat(s.amount || 0).toFixed(2)}`,
      status: s.isFinalized ? 'Finalized' : 'Active'
    }));

    console.log(`\n${colors.bold}Details${colors.reset}\n`);
    console.log(formatTable(data, columns));
  }

  console.log('');
  return billing;
}
