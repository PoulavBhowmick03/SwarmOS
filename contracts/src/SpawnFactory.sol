// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./interfaces/IERC8004Identity.sol";

interface IChildAgent {
    function initialize(address parent, address wallet) external;
}

contract SpawnFactory {
    address public immutable childImplementation;
    address public constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address public immutable lineageRegistry;
    address public owner;

    event ChildSpawned(
        address indexed child, uint256 indexed agentId, string lineageKey, uint256 generation, uint256 timestamp
    );

    constructor(address _childImpl, address _lineageRegistry) {
        if (_childImpl == address(0)) revert("SpawnFactory: zero implementation");
        if (_lineageRegistry == address(0)) revert("SpawnFactory: zero registry");

        uint256 implSize;
        assembly {
            implSize := extcodesize(_childImpl)
        }
        if (implSize == 0) revert("SpawnFactory: implementation has no code");

        childImplementation = _childImpl;
        lineageRegistry = _lineageRegistry;
        owner = msg.sender;
    }

    function spawnChild(string calldata lineageKey, uint256 generation, address childWallet)
        external
        returns (address child, uint256 agentId)
    {
        if (childWallet == address(0)) revert("SpawnFactory: zero child wallet");

        child = Clones.clone(childImplementation);
        IChildAgent(child).initialize(msg.sender, childWallet);

        if (ERC8004_REGISTRY.code.length == 0) {
            agentId = 0;
        } else {
            try IERC8004Identity(ERC8004_REGISTRY).register(child) returns (uint256 registeredAgentId) {
                agentId = registeredAgentId;
            } catch {
                agentId = 0;
            }
        }

        emit ChildSpawned(child, agentId, lineageKey, generation, block.timestamp);
    }
}
