// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LineageRegistry {
    mapping(string => string[]) private lineageCIDs;
    mapping(string => uint256) public generation;
    address public owner;
    mapping(address => bool) public allowedCallers;

    event LineageUpdated(string indexed lineageKey, string cid, uint256 generation, uint256 timestamp);
    event CallerAllowed(address indexed caller);
    event CallerRevoked(address indexed caller);
    event GenerationResult(
        string indexed lineageKey,
        string summary,
        uint256 avgYieldBps,
        uint256 agentsTerminated,
        uint256 generation,
        uint256 timestamp
    );

    error NotAllowed();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
        allowedCallers[msg.sender] = true;
    }

    modifier onlyAllowed() {
        if (!allowedCallers[msg.sender]) revert NotAllowed();
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function allowCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        allowedCallers[caller] = true;
        emit CallerAllowed(caller);
    }

    function revokeCaller(address caller) external onlyOwner {
        allowedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    function pushCID(string calldata lineageKey, string calldata cid) external onlyAllowed {
        lineageCIDs[lineageKey].push(cid);
        generation[lineageKey]++;
        emit LineageUpdated(lineageKey, cid, generation[lineageKey], block.timestamp);
    }

    function postGenerationResult(
        string calldata lineageKey,
        string calldata veniceGeneratedSummary,
        uint256 avgYieldBps,
        uint256 agentsTerminated,
        uint256 generationNumber
    ) external onlyAllowed {
        emit GenerationResult(
            lineageKey, veniceGeneratedSummary, avgYieldBps, agentsTerminated, generationNumber, block.timestamp
        );
    }

    function getLineage(string calldata lineageKey) external view returns (string[] memory) {
        return lineageCIDs[lineageKey];
    }

    function getLatestCID(string calldata lineageKey) external view returns (string memory) {
        string[] storage cids = lineageCIDs[lineageKey];
        require(cids.length > 0, "No lineage");
        return cids[cids.length - 1];
    }

    function getGenerationCount(string calldata lineageKey) external view returns (uint256) {
        return lineageCIDs[lineageKey].length;
    }
}
