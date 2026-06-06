#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  return [
    'Usage:',
    '  node scripts/update-profile-data.js --config profile.config.json',
    '',
    'Updates profile.config.json with lightweight GitHub data before SVG generation.',
    'Projects with a "repo" field are updated to the repository star count.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    args[key.slice(2)] = value;
    index += 1;
  }

  if (!args.config) {
    throw new Error(`Missing required options.\n\n${usage()}`);
  }

  return args;
}

async function fetchGitHubJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'profile-svg-generator'
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${url}`);
  }

  return response.json();
}

function formatStars(count) {
  return `${Number(count).toLocaleString('en-US')}★`;
}

async function updateProject(project) {
  if (!project.repo) {
    return project;
  }

  const repo = String(project.repo).trim();

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.warn(`Skipping invalid repo name: ${repo}`);
    return project;
  }

  try {
    const data = await fetchGitHubJson(`https://api.github.com/repos/${repo}`);
    return {
      ...project,
      value: formatStars(data.stargazers_count)
    };
  } catch (error) {
    console.warn(`Keeping current value for ${repo}: ${error.message}`);
    return project;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const profile = config.profile ?? {};
  const projects = Array.isArray(profile.projects) ? profile.projects : [];

  config.profile = {
    ...profile,
    projects: await Promise.all(projects.map(updateProject))
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Updated ${configPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
