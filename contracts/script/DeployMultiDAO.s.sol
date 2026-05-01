// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/MockGovernor.sol";
import "../src/SpawnFactory.sol";
import "../src/ChildGovernor.sol";
import "../src/ParentTreasury.sol";
import "../src/TimeLock.sol";

/// @title DeployMultiDAO — Deploys 3 separate governors for a multi-DAO swarm demo
contract DeployMultiDAO is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        // 3 separate governance contracts (different DAOs)
        MockGovernor uniswapGov = new MockGovernor(300); // 5 min
        MockGovernor lidoGov = new MockGovernor(300);
        MockGovernor ensGov = new MockGovernor(300);

        // Core infrastructure
        ParentTreasury treasury = new ParentTreasury(30, 1 ether); // 30 max for multi-perspective swarm
        ChildGovernor childImpl = new ChildGovernor();
        SpawnFactory factory = new SpawnFactory(address(treasury), address(childImpl));
        TimeLock timeLock = new TimeLock();

        // Wire up
        treasury.setSpawnFactory(address(factory));
        treasury.setGovernanceValues(
            "Prioritize decentralization, oppose token inflation, support public goods funding, favor progressive decentralization"
        );

        vm.stopBroadcast();

        console.log("=== Multi-DAO Deployment ===");
        console.log("Uniswap Governor:", address(uniswapGov));
        console.log("Lido Governor:", address(lidoGov));
        console.log("ENS Governor:", address(ensGov));
        console.log("ParentTreasury:", address(treasury));
        console.log("ChildGovernor (impl):", address(childImpl));
        console.log("SpawnFactory:", address(factory));
        console.log("TimeLock:", address(timeLock));
    }
}
