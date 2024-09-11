import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import hre, { run } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
const { randomInt } = require("node:crypto");

import { GameState, prove, toOnChainProof, zeroPadNBytes } from "./helpers";
// @ts-ignore: typechain folder will be generated after contracts compilation
import { GuessingGame } from "../typechain-types";

chai.use(chaiAsPromised);
const expect = chai.expect;

// Defining circuit base paths
const SUBMIT_RANGECHECK_CIRCUIT_BASEPATH = "./artifacts/circuits/submit-rangecheck-1-100";

describe("GuessingGame", () => {
  async function deployContractsCleanSlate() {
    const contracts = await run("deploy", { logs: false });
    const [host, bob, charlie] = await hre.ethers.getSigners();
    Object.values(contracts).map((c) => c.connect(host));

    return { contracts, players: { host, bob, charlie } };
  }

  async function deployContractsGameStarted() {
    const contracts = await run("deploy", { logs: false });
    const [host, bob, charlie, dave] = await hre.ethers.getSigners();
    Object.values(contracts).map((c) => c.connect(host));

    const { gameContract } = contracts;

    const GAME_ID = 0;
    await gameContract.newGame();
    await Promise.all([
      gameContract.connect(bob).joinGame(GAME_ID),
      gameContract.connect(charlie).joinGame(GAME_ID),
    ]);
    await gameContract.startGame(GAME_ID);

    return { contracts, players: { host, bob, charlie, dave } };
  }

  describe("L New Game", () => {
    it("should create a new game", async () => {
      const { contracts, players } = await loadFixture(deployContractsCleanSlate);
      const { gameContract } = contracts;
      const { host } = players;

      await gameContract.newGame();

      const GAME_ID = 0;
      const game = await gameContract.getGame(GAME_ID);
      expect(game.state).to.be.equal(GameState.GameInitiated);

      const gameHost = await gameContract.getGameHost(GAME_ID);
      expect(gameHost).to.be.equal(host);
    });

    it("host can't join the game again, but other players can", async () => {
      const { contracts, players } = await loadFixture(deployContractsCleanSlate);
      const { gameContract } = contracts;
      const { host, bob } = players;

      await gameContract.newGame();

      const GAME_ID = 0;
      await expect(gameContract.joinGame(GAME_ID)).to.be.revertedWithCustomError(
        gameContract,
        "GuessingGame__PlayerAlreadyJoin"
      );

      await expect(gameContract.connect(bob).joinGame(GAME_ID))
        .to.emit(gameContract, "PlayerJoinGame")
        .withArgs(GAME_ID, bob.address);

      const game = await gameContract.getGame(GAME_ID);
      expect(game.players).to.deep.equal([host.address, bob.address]);
    });

    it("can start game by host once there are more than two players", async () => {
      const { contracts, players } = await loadFixture(deployContractsCleanSlate);
      const { gameContract } = contracts;
      const { host, bob, charlie } = players;

      await gameContract.newGame();

      const GAME_ID = 0;
      await gameContract.connect(bob).joinGame(GAME_ID);
      await expect(gameContract.startGame(GAME_ID)).to.be.revertedWithCustomError(
        gameContract,
        "GuessingGame__NotEnoughPlayers"
      );

      await gameContract.connect(charlie).joinGame(GAME_ID);
      await expect(gameContract.connect(host).startGame(GAME_ID))
        .to.emit(gameContract, "GameStarted")
        .withArgs(GAME_ID);

      const game = await gameContract.getGame(GAME_ID);
      expect(game.state).to.be.equal(GameState.RoundBid);
    });
  });

  describe("L After a game started", () => {
    it("only players can submit a commitment, non-players cannot", async () => {
      const { contracts, players } = await loadFixture(deployContractsGameStarted);
      const { gameContract } = contracts;
      const { host, dave } = players;

      const GAME_ID = 0;
      const rand = randomInt(281474976710655);
      // generate proof
      const input = { in: 99, rand };
      const { proof, publicSignals } = await prove(input, SUBMIT_RANGECHECK_CIRCUIT_BASEPATH);

      // host can submit a commitment
      await expect(gameContract.submitCommitment(GAME_ID, toOnChainProof(proof), publicSignals))
        .to.emit(gameContract, "BidSubmitted")
        .withArgs(GAME_ID, 0, host.address);

      // check the relevant game state on-chain
      const bid = await gameContract.getPlayerCommitment(GAME_ID, 0, host.address);
      expect(bid).to.deep.equal(publicSignals);

      // dave couldn't submit a commitment
      const daveGameContract = gameContract.connect(dave);
      await expect(
        daveGameContract.submitCommitment(GAME_ID, toOnChainProof(proof), publicSignals)
      ).to.be.revertedWithCustomError(gameContract, "GuessingGame__NotOneOfPlayers");
    });

    it("invalid submit-rangecheck proof will be rejected", async () => {
      const { contracts, players } = await loadFixture(deployContractsGameStarted);
      const { gameContract } = contracts;
      const { host } = players;

      const GAME_ID = 0;
      const rand = randomInt(281474976710655);

      // generate a proof
      const input = { in: 99, rand };
      const { proof, publicSignals } = await prove(input, SUBMIT_RANGECHECK_CIRCUIT_BASEPATH);
      let onChainProof = toOnChainProof(proof);
      // meddle the proof
      onChainProof[0] = zeroPadNBytes(BigInt(onChainProof[0]) + BigInt(1), 32);

      // submit on-chain
      await expect(
        gameContract.submitCommitment(GAME_ID, onChainProof, publicSignals)
      ).to.be.revertedWithCustomError(gameContract, "GuessingGame__InvalidSubmitRangeCheckProof");
    });
  });

  describe("L Range check: genarate proof offchain, verify proof onchain", () => {
    it("should create a range proof and be verified", async () => {
      const { contracts } = await loadFixture(deployContractsCleanSlate);
      const { rcContract } = contracts;

      const rand = randomInt(281474976710655);

      // generate proof
      const input = { in: 99, rand };
      const { proof, publicSignals } = await prove(input, SUBMIT_RANGECHECK_CIRCUIT_BASEPATH);
      const result = await rcContract.verifyProof(toOnChainProof(proof), publicSignals);
      expect(result).to.be.true;
    });
  });
});
