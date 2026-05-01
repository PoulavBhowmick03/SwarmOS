// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/MockGovernor.sol";

contract MockGovernorTest is Test {
    MockGovernor gov;
    address voter1 = makeAddr("voter1");
    address voter2 = makeAddr("voter2");

    function setUp() public {
        gov = new MockGovernor(300); // 5 min voting period
    }

    function test_createProposal() public {
        uint256 id = gov.createProposal("Should we fund project X?");
        assertEq(id, 1);
        assertEq(gov.proposalCount(), 1);

        MockGovernor.ProposalInfo memory p = gov.getProposal(1);
        assertEq(p.id, 1);
        assertEq(p.endTime - p.startTime, 300);
    }

    function test_castVote() public {
        gov.createProposal("Test proposal");

        vm.prank(voter1);
        gov.castVote(1, 1); // FOR

        vm.prank(voter2);
        gov.castVote(1, 0); // AGAINST

        MockGovernor.ProposalInfo memory p = gov.getProposal(1);
        assertEq(p.forVotes, 1);
        assertEq(p.againstVotes, 1);
    }

    function test_cannotVoteTwice() public {
        gov.createProposal("Test");

        vm.prank(voter1);
        gov.castVote(1, 1);

        vm.prank(voter1);
        vm.expectRevert("already voted");
        gov.castVote(1, 0);
    }

    function test_cannotVoteAfterEnd() public {
        gov.createProposal("Test");
        vm.warp(block.timestamp + 301);

        vm.prank(voter1);
        vm.expectRevert("voting not active");
        gov.castVote(1, 1);
    }

    function test_stateTransitions() public {
        gov.createProposal("Test");

        // Active immediately (no pending delay in mock)
        assertEq(uint256(gov.state(1)), uint256(MockGovernor.ProposalState.Active));

        vm.prank(voter1);
        gov.castVote(1, 1);

        // After voting ends with more FOR votes
        vm.warp(block.timestamp + 301);
        assertEq(uint256(gov.state(1)), uint256(MockGovernor.ProposalState.Succeeded));

        // Execute
        gov.execute(1);
        assertEq(uint256(gov.state(1)), uint256(MockGovernor.ProposalState.Executed));
    }

    function test_defeatedProposal() public {
        gov.createProposal("Test");

        vm.prank(voter1);
        gov.castVote(1, 0); // AGAINST

        vm.warp(block.timestamp + 301);
        assertEq(uint256(gov.state(1)), uint256(MockGovernor.ProposalState.Defeated));

        vm.expectRevert("proposal defeated");
        gov.execute(1);
    }

    function test_castVoteWithReason() public {
        gov.createProposal("Test");

        vm.prank(voter1);
        gov.castVoteWithReason(1, 1, "I support this because...");

        MockGovernor.ProposalInfo memory p = gov.getProposal(1);
        assertEq(p.forVotes, 1);
    }
}
