import { expect } from "chai";
import hre, { run } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
const { randomInt } = require("node:crypto");

import { prove, toOnChainProof } from "./helpers";
// @ts-ignore: typechain folder will be generated after contracts compilation
import { GuessingGame } from "../typechain-types";

// Defining circuit base paths
const SUBMIT_RANGECHECK_CIRCUIT_BASEPATH = "./artifacts/circuits/submit-rangecheck-1-100";

describe("Submit-Rangecheck: genarate proof offchain, verify proof onchain", () => {
  async function deployVerifierContracts() {
    const contracts = await run("deploy:game-verifiers", { logs: false });
    const [host, bob, charlie] = await hre.ethers.getSigners();
    Object.values(contracts).map((c) => c.connect(host));

    return { contracts, players: { host, bob, charlie } };
  }

  it("should create a range proof and be verified", async () => {
    const { contracts } = await loadFixture(deployVerifierContracts);
    const { rcContract } = contracts;

    const rand = randomInt(281474976710655);

    // generate proof
    const input = { in: 99, rand };
    const { proof, publicSignals } = await prove(input, SUBMIT_RANGECHECK_CIRCUIT_BASEPATH);
    const result = await rcContract.verifyProof(toOnChainProof(proof), publicSignals);
    expect(result).to.be.true;
  });
});
